import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "ssh2";
import { sessionError } from "./errors.js";
import { setTimeout as delay } from "node:timers/promises";

export const sshFingerprint = key => "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
export const sshEndpoint = environment => `${String(environment.host).trim().toLowerCase()}:${environment.port ?? 22}`;

export async function connectSsh(environment, { password, verifyHost, signal, ClientType = Client } = {}) {
  signal?.throwIfAborted();
  const client = new ClientType();
  const config = { host: environment.host, port: environment.port ?? 22, username: environment.username,
    readyTimeout: environment.readyTimeoutMs ?? 15000, keepaliveInterval: 10000, keepaliveCountMax: 3 };
  if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
  if (password) config.password = password;
  let identity, identityError;
  config.hostVerifier = (key, done) => {
    const fingerprint = sshFingerprint(key);
    Promise.resolve().then(() => verifyHost(fingerprint)).then(value => { identity = value; done(true); }, error => { identityError = error; done(false); });
  };
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); if (error) reject(identityError ?? error); else resolve(); };
      const abort = () => { finish(signal.reason ?? sessionError("SSH_CANCELLED", "Connection cancelled")); client.destroy(); };
      const timer = setTimeout(() => finish(sessionError("SSH_CONNECT_TIMEOUT", `SSH handshake timed out: ${config.host}:${config.port}`)), config.readyTimeout);
      client.on("error", error => finish(error)); // Keep a listener for late transport errors.
      client.once("close", () => finish(sessionError("SSH_CONNECTION_CLOSED", "SSH closed before authentication completed")));
      client.once("ready", () => finish());
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort(); else client.connect(config);
    });
    return { client, identity: identity ?? null };
  } catch (cause) {
    client.destroy();
    if (identityError) throw identityError;
    const error = sessionError(cause.level === "client-authentication" ? "SSH_AUTH_FAILED" : cause.code ?? "SSH_CONNECT_FAILED", `${environment.name} (${config.host}:${config.port}): ${cause.message}`, cause);
    error.stage = cause.level === "client-authentication" ? "authentication" : "connection";
    throw error;
  }
}

export function sshChannel(client, open, timeoutMs = 15000, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, channel) => {
      if (settled) { channel?.close?.(); return; }
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); client.off("close", closed);
      if (error) reject(error); else resolve(channel);
    };
    const closed = () => finish(sessionError("SSH_CHANNEL_CLOSED", "Connection closed while opening the channel"));
    const abort = () => finish(signal.reason ?? sessionError("SSH_CANCELLED", "Channel opening cancelled"));
    const timer = setTimeout(() => finish(sessionError("SSH_CHANNEL_TIMEOUT", "Opening the SSH channel timed out")), timeoutMs);
    client.once("close", closed); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else { try { open(finish); } catch (error) { finish(error); } }
  });
}

export async function openSftpChannel(client, { windows = false, timeoutMs = 15000, signal } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const channel = await sshChannel(client, callback => client.sftp(callback), timeoutMs, signal);
      channel.openAttempts = attempt;
      return channel;
    } catch (error) {
      // Win32 OpenSSH can fail to initialize sftp-server.exe (STATUS_DLL_INIT_FAILED)
      // after a console process exits. No SFTP request has been dispatched at this point.
      if (!windows || error.code !== 3221225794 || attempt === 2) throw error;
      await delay(200, undefined, { signal });
    }
  }
}
