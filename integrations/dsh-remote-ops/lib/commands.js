import { StringDecoder } from "node:string_decoder";

const failure = (code, message) => Object.assign(new Error(message), { code });
const bounded = limit => {
  const decoder = new StringDecoder("utf8");
  let text = "", bytes = 0, truncated = false;
  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, limit - bytes);
      if (remaining) text += decoder.write(buffer.subarray(0, remaining));
      bytes += buffer.length;
      truncated ||= bytes > limit;
    },
    result() { return { text: text + (truncated ? "" : decoder.end()), truncated }; },
  };
};

// This channel never writes to, or infers completion from, the interactive PTY.
export async function executeCommand({ subprocess, client, command, cwd, signal, timeoutMs = 30000, maxBytes = 65536, platform = process.platform }) {
  if (typeof command !== "string" || !command.trim() || command.length > 32768 || command.includes("\0")) throw failure("COMMAND_INVALID", "Command must contain 1-32768 characters without NUL");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 262144) throw failure("COMMAND_LIMIT_INVALID", "Timeout must be 1-300000 ms; output limit 1024-262144 bytes per stream");
  const started = Date.now(), stdout = bounded(maxBytes), stderr = bounded(maxBytes);
  let stop, outcome, stopped = false, cause, abortResolve, timer;
  const aborted = new Promise(resolve => { abortResolve = resolve; });
  const abort = reason => { if (stopped) return; stopped = true; cause = reason; try { stop?.(); } finally { abortResolve(null); } };
  const onAbort = () => abort("cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => abort("timed_out"), timeoutMs);
  const listeners = [];
  const listen = (stream, event, handler) => { stream?.on(event, handler); listeners.push(() => stream?.off(event, handler)); };
  try {
    if (signal?.aborted) onAbort();
    if (!stopped) {
      if (client) {
        outcome = new Promise((resolve, reject) => {
          client.exec(command, (error, channel) => {
            if (error) { reject(error); return; }
            stop = () => { try { channel.signal?.("TERM"); } catch { /* Servers may not support channel signals. */ } channel.close?.(); channel.destroy?.(); };
            if (stopped) { channel.on("error", () => {}); stop(); resolve({ exitCode: null, signal: null }); return; }
            let exitCode = null, exitSignal = null;
            listen(channel, "data", chunk => stdout.append(chunk));
            listen(channel.stderr, "data", chunk => stderr.append(chunk));
            listen(channel, "exit", (code, name) => { exitCode = Number.isInteger(code) ? code : null; exitSignal = name ?? null; });
            listen(channel, "error", reject);
            listen(channel, "close", () => resolve({ exitCode, signal: exitSignal }));
            channel.end();
          });
        });
      } else {
        if (!subprocess?.spawn) throw failure("COMMAND_PROVIDER_UNAVAILABLE", "Harness subprocess.spawn is unavailable");
        const argv = platform === "win32" ? [process.env.ComSpec || "cmd.exe", "/D", "/S", "/C", "chcp 65001>nul & " + command] : ["/bin/sh", "-c", command];
        const handle = await subprocess.spawn({ argv, cwd, stdio: { stdin: "ignore", stdout: "pipe", stderr: "pipe" }, graceMs: 1000, signal });
        listen(handle.stdout, "data", chunk => stdout.append(chunk));
        listen(handle.stderr, "data", chunk => stderr.append(chunk));
        stop = () => handle.terminate();
        outcome = handle.done;
        if (stopped) stop();
      }
    }
    let facts = outcome ? await Promise.race([outcome, aborted]) : null;
    if (stopped && outcome) {
      // Bound shutdown observation; remote channel closure is not proof of process death.
      let cleanupTimer;
      facts = await Promise.race([outcome.catch(() => null), new Promise(resolve => { cleanupTimer = setTimeout(() => resolve(null), 1500); })]);
      clearTimeout(cleanupTimer);
    }
    const out = stdout.result(), err = stderr.result();
    const knownExit = Number.isInteger(facts?.exitCode);
    return {
      mode: "independent", inheritsTerminalState: false, workingDirectory: client ? null : cwd,
      status: cause ?? (knownExit ? facts.exitCode === 0 ? "completed" : "failed" : "unknown"),
      completion: !stopped && knownExit ? "exited" : "unknown",
      exitCode: facts?.exitCode ?? null, signal: facts?.signal ?? null,
      stdout: out.text, stderr: err.text, stdoutTruncated: out.truncated, stderrTruncated: err.truncated,
      durationMs: Date.now() - started, terminationConfirmed: stopped ? !client && Boolean(facts) : null,
    };
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
    for (const remove of listeners) remove();
  }
}
