import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { connectSsh, sshEndpoint, sshChannel, openSftpChannel, closeSshClient } from "../ssh-connection.js";
import { sessionError } from "../errors.js";
import { executeCommand } from "../commands.js";
import { buildSshShellOptions } from "../terminal-sessions.js";
import { interactiveWindowsCommand, isWindowsEnvironment, windowsProbeCommand } from "../windows-shell.js";

export const withSsh = Base => class SshLayer extends Base {
  async verifySshHost(environment, fingerprint) {
    const endpoint = sshEndpoint(environment);
    this.sshHostWrites ??= Promise.resolve();
    const operation = this.sshHostWrites.then(async () => {
      const file = join(this.base, "ssh-host-keys.json");
      if (!this.sshHostKeys) {
        try {
          const keys = JSON.parse(await readFile(file, "utf8"));
          if (!keys || typeof keys !== "object" || Array.isArray(keys) || Object.values(keys).some(value => typeof value !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(value))) throw new Error("Invalid fingerprint entries");
          this.sshHostKeys = keys;
        } catch (error) {
          if (error.code === "ENOENT") this.sshHostKeys = {};
          else throw Object.assign(sessionError("SSH_HOST_STORE_INVALID", "Saved SSH host identities could not be read. Restore the verified identity file before connecting", error), { stage: "host-key" });
        }
      }
      const known = this.sshHostKeys[endpoint];
      const expected = environment.hostKeySha256 || known;
      if (expected && expected !== fingerprint) {
        const error = sessionError("SSH_HOST_KEY_CHANGED", `${endpoint}: expected ${expected}; received ${fingerprint}. Verify the host identity before updating its saved fingerprint`);
        Object.assign(error, { stage: "host-key", endpoint, expectedFingerprint: expected, observedFingerprint: fingerprint });
        throw error;
      }
      if (known !== fingerprint) {
        const next = { ...this.sshHostKeys, [endpoint]: fingerprint };
        await writeFile(file + ".tmp", JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        await rename(file + ".tmp", file);
        this.sshHostKeys = next;
      }
      return { endpoint, fingerprint, trust: environment.hostKeySha256 ? "pinned" : known ? "remembered" : "first-use" };
    });
    this.sshHostWrites = operation.catch(() => {});
    return operation;
  }

  async connectSshEnvironment(environment, signal) {
    return connectSsh(environment, { password: await this.resolvePassword(environment), signal, verifyHost: fingerprint => this.verifySshHost(environment, fingerprint) });
  }

  async testEnvironment(id, { signal } = {}) {
    await this.ready;
    const environment = this.findEnvironment(id);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", String(id));
    const result = { environmentId: environment.id, endpoint: sshEndpoint(environment), checkedAt: new Date().toISOString(), stages: [], capabilities: {} };
    let client;
    const run = async (stage, work) => {
      try { const value = await work(); result.stages.push({ stage, ok: true }); return value; }
      catch (error) { result.stages.push({ stage: error.stage ?? stage, ok: false, code: error.code ?? "SSH_TEST_FAILED", message: error.message }); return null; }
    };
    try {
      const connected = await run("connection", () => this.connectSshEnvironment(environment, signal));
      if (!connected) return { ...result, ok: false };
      client = connected.client; result.identity = connected.identity;
      result.stages.push({ stage: "authentication", ok: true });
      if (environment.platform !== "posix") {
        try {
          const probe = await executeCommand({ client, ...windowsProbeCommand(), signal, timeoutMs: environment.readyTimeoutMs ?? 15000, maxBytes: 16384 });
          let facts;
          try { if (probe.exitCode === 0) facts = JSON.parse(probe.stdout.trim()); } catch { /* Non-Windows CLI or unexpected output. */ }
          if (facts?.platform !== "windows") throw sessionError("WINDOWS_PROBE_FAILED", `Windows probe ${probe.status}, exitCode=${probe.exitCode}: ${probe.stderr || probe.stdout || "No system facts returned"}`);
          result.detected = facts; result.stages.push({ stage: "platform", ok: true });
        } catch (error) {
          // Auto also covers Linux and device CLIs; an absent PowerShell is not their failure.
          if (isWindowsEnvironment(environment)) result.stages.push({ stage: "platform", ok: false, code: error.code ?? "WINDOWS_PROBE_FAILED", message: error.message });
        }
      }
      if (!result.detected && !isWindowsEnvironment(environment)) {
        const probe = await run("platform", async () => {
          const value = await executeCommand({ client, command: "uname -s; pwd", signal, timeoutMs: 10000, maxBytes: 4096 });
          if (value.exitCode !== 0 || !/^(Linux|Darwin|FreeBSD|OpenBSD|NetBSD|SunOS)\r?\n/.test(value.stdout)) throw sessionError("SSH_PLATFORM_UNKNOWN", "System was not identified; use server-default for a device CLI");
          return { platform: "posix", osName: value.stdout.split(/\r?\n/)[0], cwd: value.stdout.split(/\r?\n/)[1] };
        });
        if (probe) result.detected = probe;
      }
      const target = { ...environment, ...(result.detected?.platform === "windows" ? { platform: "windows" } : {}) };
      const shell = buildSshShellOptions(target), command = interactiveWindowsCommand(target);
      const pty = await run("shell", () => {
        const executable = { cmd: "cmd.exe", "windows-powershell": "powershell.exe", pwsh: "pwsh.exe" }[target.shell];
        if (executable && !result.detected?.availableShells?.some(item => item.name === executable)) throw sessionError("WINDOWS_SHELL_NOT_FOUND", `${executable} is not available on the target`);
        return sshChannel(client, callback => command ? client.exec(command, { pty: shell.window }, callback) : client.shell(shell.window, shell.options, callback), 15000, signal);
      });
      result.capabilities.pty = Boolean(pty); pty?.on("error", () => {}); pty?.close();
      result.capabilities.exec = Boolean(result.detected);
      result.capabilities.shell = environment.shell ?? "server-default";
      const sftp = await run("sftp", () => openSftpChannel(client, { windows: isWindowsEnvironment(target), signal }));
      result.capabilities.sftp = Boolean(sftp);
      if (sftp) result.capabilities.sftpOpenAttempts = sftp.openAttempts;
      if (sftp) {
        try { result.capabilities.sftpHome = await run("sftp-path", () => sshChannel(client, callback => sftp.realpath(".", callback), environment.readyTimeoutMs ?? 15000, signal, "Resolving the SFTP home directory")); }
        finally { sftp.end(); }
      }
      return { ...result, ok: result.stages.every(stage => stage.ok) };
    } finally { closeSshClient(client); }
  }
};
