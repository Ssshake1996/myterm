import { sessionError } from "./errors.js";

export const LOCAL_SHELLS = {
  cmd: { name: "CMD", executable: "cmd.exe" },
  powershell: { name: "Windows PowerShell 5.1", executable: "powershell.exe" },
  pwsh: { name: "PowerShell 7", executable: "pwsh.exe" },
  wsl: { name: "WSL", executable: "wsl.exe" },
  sh: { name: "Shell", executable: "/bin/sh" },
};

export function localOptions(value = {}, platform = process.platform) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw sessionError("LOCAL_OPTIONS_INVALID", "Local terminal options must be an object");
  const result = { shell: value.shell ?? (platform === "win32" ? "cmd" : "sh") };
  if (!Object.hasOwn(LOCAL_SHELLS, result.shell) || (platform === "win32" ? result.shell === "sh" : result.shell !== "sh")) throw sessionError("LOCAL_SHELL_UNAVAILABLE", "This shell is unavailable on the DSH host");
  for (const field of ["distribution", "user", "cwd"]) {
    const text = value[field] ?? "";
    if (typeof text !== "string" || text.length > 4096 || /[\x00-\x1f]/.test(text)) throw sessionError("LOCAL_OPTIONS_INVALID", `Invalid ${field}`);
    result[field] = text.trim();
  }
  if (result.shell !== "wsl" && (result.distribution || result.user)) throw sessionError("LOCAL_OPTIONS_INVALID", "distribution and user require WSL");
  if (result.shell === "wsl" && result.cwd && result.cwd !== "~" && !result.cwd.startsWith("/")) throw sessionError("LOCAL_OPTIONS_INVALID", "WSL starting directory must be ~ or an absolute Linux path");
  return result;
}

export function decodeLocalProbe(buffer) {
  return buffer.toString(buffer.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, "").trim();
}

async function probe(subprocess, argv, cwd) {
  const controller = new AbortController(), chunks = [];
  let bytes = 0, child;
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    child = await subprocess.spawn({ argv, cwd, stdio: { stdin: "ignore", stdout: "pipe", stderr: "pipe" }, signal: controller.signal, graceMs: 500 });
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes <= 65536) chunks.push(Buffer.from(chunk)); else controller.abort(); });
    child.stderr.on("data", () => {});
    const outcome = await child.done;
    if (outcome.exitCode !== 0 || controller.signal.aborted) throw sessionError("LOCAL_PROBE_FAILED", "Unable to inspect this local shell");
    return decodeLocalProbe(Buffer.concat(chunks));
  } finally { clearTimeout(timer); if (controller.signal.aborted) await child?.terminate(); }
}

export async function listLocalShells(subprocess, cwd, platform = process.platform) {
  const shells = [];
  for (const shell of platform === "win32" ? ["cmd", "powershell", "pwsh", "wsl"] : ["sh"]) {
    const definition = LOCAL_SHELLS[shell];
    let executable;
    try { executable = await subprocess.resolveExecutable(definition.executable); } catch { /* Report the unavailable entry. */ }
    if (!executable) { shells.push({ shell, name: definition.name, available: false, reason: "未安装或 DSH 找不到可执行文件" }); continue; }
    if (shell !== "wsl") { shells.push({ shell, name: definition.name, executable, available: true }); continue; }
    try {
      const names = (await probe(subprocess, [executable, "--list", "--quiet"], cwd)).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!names.length) throw sessionError("WSL_NO_DISTRIBUTION", "No installed WSL distribution");
      for (const distribution of names) shells.push({ shell, distribution, name: "WSL · " + distribution, executable, available: true });
    } catch { shells.push({ shell, name: "WSL", available: false, reason: "未发现可用发行版，请检查 wsl --list --verbose" }); }
  }
  return shells;
}

const utf8PowerShell = "$OutputEncoding=[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();";

export function localShellArgv(options, executable, command) {
  const interactive = command === undefined;
  if (options.shell === "cmd") return interactive ? [executable, "/D", "/Q", "/K", "chcp 65001>nul"] : [executable, "/D", "/S", "/C", "chcp 65001>nul & " + command];
  if (options.shell === "powershell" || options.shell === "pwsh") {
    const script = utf8PowerShell + (interactive ? "" : command);
    return [executable, "-NoLogo", "-NoProfile", ...(interactive ? ["-NoExit"] : []), "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  }
  if (options.shell === "wsl") return [executable, ...(options.distribution ? ["--distribution", options.distribution] : []), ...(options.user ? ["--user", options.user] : []), "--cd", options.cwd || "~", ...(interactive ? [] : ["--exec", "/bin/sh", "-c", command])];
  return interactive ? [executable, "-i"] : [executable, "-c", command];
}
