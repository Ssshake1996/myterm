import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Client as SshClient } from "ssh2";
import { HostFiles, SftpFiles } from "../transfers.js";
import { MAX_SFTP_BYTES } from "../constants.js";
import { ownerId, sessionError } from "../common.js";

// Local and SFTP file access used by the file workspace and the sftp tools.
export const withFiles = (Base) => class FilesLayer extends Base {
  async listLocalFiles(pathValue = this.base) {
    const path = resolve(String(pathValue || this.base));
    const directory = await readdir(path, { withFileTypes: true });
    const entries = await Promise.all(directory.map(async (entry) => {
      const entryPath = join(path, entry.name);
      const details = await stat(entryPath);
      return { name: entry.name, type: entry.isDirectory() ? "d" : "-", size: entry.isFile() ? details.size : 0, modifyTime: details.mtimeMs, path: entryPath };
    }));
    entries.sort((left, right) => Number(right.type === "d") - Number(left.type === "d") || left.name.localeCompare(right.name));
    return { path, entries };
  }

  async connectFiles(endpoint, signal) {
    if (endpoint.kind === "host") return new HostFiles();
    if (endpoint.kind !== "ssh") throw sessionError("SFTP_ENDPOINT_INVALID", "Select the DSH host or an SSH environment");
    const environment = this.findEnvironment(endpoint.environment);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${endpoint.environment}`);
    const client = new SshClient();
    try {
      const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000 };
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment); if (password) config.password = password;
      const sftp = await new Promise((resolve, reject) => {
        const abort = () => { client.destroy(); reject(signal.reason ?? new Error("aborted")); };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        const finish = (error, value) => { signal?.removeEventListener("abort", abort); if (error) reject(error); else resolve(value); };
        client.once("error", finish);
        client.once("ready", () => client.sftp(finish));
        client.connect(config);
      });
      return new SftpFiles(client, sftp, signal);
    } catch (error) { client.end(); throw sessionError("SFTP_CONNECT_FAILED", "Unable to open SFTP channel", error); }
  }

  async listFiles(endpoint, signal) {
    const files = await this.connectFiles(endpoint, signal);
    try {
      const path = await files.canonical(endpoint.path || (endpoint.kind === "host" ? this.base : "."));
      const entries = [];
      for (const name of await files.list(path)) {
        const details = await files.stat(files.join(path, name));
        entries.push({ name, type: details?.type === "directory" ? "d" : details?.type === "file" ? "-" : "l", size: details?.size ?? 0 });
      }
      entries.sort((a, b) => Number(b.type === "d") - Number(a.type === "d") || a.name.localeCompare(b.name));
      return { path, entries };
    } finally { files.close(); }
  }

  async sftp(owner, environmentId, action, args) {
    await this.ready;
    const environment = this.findEnvironment(environmentId);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${environmentId}`);
    if (action === "upload" || action === "download") {
      const upload = action === "upload";
      const remote = String(args.remotePath).replace(/\\/g, "/");
      const slash = remote.lastIndexOf("/");
      const local = resolve(String(args.localPath));
      const from = upload ? { kind: "host", path: dirname(local) } : { kind: "ssh", environment: environment.id, path: slash < 0 ? "." : remote.slice(0, slash) || "/" };
      const to = upload ? { kind: "ssh", environment: environment.id, path: slash < 0 ? "." : remote.slice(0, slash) || "/" } : { kind: "host", path: dirname(local) };
      const localName = basename(local), remoteName = remote.slice(slash + 1);
      if (!upload) await mkdir(dirname(local), { recursive: true });
      const task = this.transfers.start(ownerId(owner), { source: from, target: to, names: [upload ? localName : remoteName], targetName: upload ? remoteName : localName, conflict: args.overwrite ? "overwrite" : "error" });
      const abort = () => this.transfers.cancel(ownerId(owner), task.id);
      if (args.signal?.aborted) abort(); else args.signal?.addEventListener("abort", abort, { once: true });
      let result;
      try { result = await this.transfers.wait(ownerId(owner), task.id); } finally { args.signal?.removeEventListener("abort", abort); }
      if (result.status !== "completed") throw sessionError(result.error.code, result.error.message, result.error);
      return { localPath: local, remotePath: remote, [upload ? "uploaded" : "downloaded"]: result.bytes };
    }
    const client = new SshClient();
    try {
      const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000 };
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment); if (password) config.password = password;
      await new Promise((resolve, reject) => { client.once("ready", resolve); client.once("error", reject); client.connect(config); });
      const sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
      const call = (method, ...values) => new Promise((resolve, reject) => sftp[method](...values, (error, value) => error ? reject(error) : resolve(value)));
      if (action === "list") { const entries = await call("readdir", args.path ?? "."); return { path: args.path ?? ".", entries: entries.map((entry) => ({ name: entry.filename, type: (entry.attrs?.mode & 0o170000) === 0o040000 ? "d" : "-", size: entry.attrs?.size ?? 0, modifyTime: entry.attrs?.mtime })) }; }
      if (action === "read") { const chunks = []; let size = 0; await new Promise((resolve, reject) => { const stream = sftp.createReadStream(args.path); stream.on("data", (chunk) => { size += chunk.length; if (size > MAX_SFTP_BYTES) { stream.destroy(sessionError("SFTP_READ_LIMIT", `File exceeds ${MAX_SFTP_BYTES} bytes`)); return; } chunks.push(chunk); }); stream.once("error", reject); stream.once("close", resolve); }); return { path: args.path, content: Buffer.concat(chunks).toString("utf8") }; }
      if (action === "write") { await new Promise((resolve, reject) => { const stream = sftp.createWriteStream(args.path); stream.once("error", reject); stream.once("close", resolve); stream.end(Buffer.from(args.content ?? "", "utf8")); }); return { path: args.path, written: Buffer.byteLength(args.content ?? "", "utf8") }; }
      if (action === "mkdir") { const parts = String(args.path).split(/[\\/]+/).filter(Boolean); let current = String(args.path).startsWith("/") ? "" : "."; for (const part of parts) { current += `/${part}`; await call("mkdir", current).catch(() => {}); } return { path: args.path, created: true }; }
      if (action === "delete") { const stat = await call("stat", args.path); if ((stat.mode & 0o170000) === 0o040000) await call("rmdir", args.path); else await call("unlink", args.path); return { path: args.path, deleted: true }; }
      if (action === "rename") { await call("rename", args.from, args.to); return { from: args.from, to: args.to, renamed: true }; }
      throw new Error(`Unsupported SFTP action: ${action}`);
    } finally { client.end(); }
  }
};
