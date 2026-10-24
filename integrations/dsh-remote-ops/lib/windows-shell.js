import { sessionError } from "./errors.js";

export const WINDOWS_SHELLS = ["server-default", "cmd", "windows-powershell", "pwsh"];
export const isWindowsEnvironment = environment => environment?.platform === "windows" || ["cmd", "windows-powershell", "pwsh"].includes(environment?.shell);
const encoded = script => Buffer.from(script, "utf16le").toString("base64");
const utf8 = "$u=New-Object System.Text.UTF8Encoding $false;[Console]::InputEncoding=$u;[Console]::OutputEncoding=$u;$OutputEncoding=$u;";

export function interactiveWindowsCommand(environment) {
  const shell = environment?.shell ?? "server-default";
  if (shell === "server-default") return null;
  if (!WINDOWS_SHELLS.includes(shell)) throw sessionError("WINDOWS_SHELL_INVALID", "Select cmd, windows-powershell, pwsh or server-default");
  if (shell === "cmd") return 'cmd.exe /D /K "chcp 65001>nul"';
  return `${shell === "pwsh" ? "pwsh.exe" : "powershell.exe"} -NoLogo -NoProfile -NoExit -EncodedCommand ${encoded(utf8)}`;
}

// Keep command text, paths and parameters off the SSH launcher command line. JSON goes through
// stdin, not shell interpolation; the short UTF-16LE launcher works with CMD and PowerShell defaults.
const bootstrap = utf8 + String.raw`
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$temp=$null
try {
  $p=[Console]::In.ReadToEnd()|ConvertFrom-Json
  if ($p.workingDirectory) { Set-Location -LiteralPath $p.workingDirectory }
  $global:LASTEXITCODE=0
  if ($p.shell -eq 'cmd') {
    $temp=Join-Path ([IO.Path]::GetTempPath()) ('remote-ops-'+[guid]::NewGuid().ToString('N')+'.cmd')
    [IO.File]::WriteAllText($temp,('@echo off'+[Environment]::NewLine+'chcp 65001>nul'+[Environment]::NewLine+$p.command+[Environment]::NewLine),$u)
    & $env:ComSpec /D /Q /V:OFF /S /C ('"'+$temp+'"')
  } else {
    $params=@{};if ($p.parameters) { foreach($v in $p.parameters.PSObject.Properties) { $params[$v.Name]=$v.Value } }
    & ([scriptblock]::Create($p.command)) @params | Out-String -Stream -Width 4096 | ForEach-Object { [Console]::Out.WriteLine($_) }
  }
  $ok=$?;$code=$global:LASTEXITCODE
  if (-not $ok -and $code -eq 0) { $code=1 }
} catch { [Console]::Error.WriteLine($_.ToString());$code=1 }
finally { if ($temp -and [IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
exit $code
`;

export function buildWindowsCommand({ command, shell, parameters, workingDirectory }) {
  if (!["cmd", "windows-powershell", "pwsh"].includes(shell)) throw sessionError("WINDOWS_COMMAND_INVALID", "Select an explicit Windows shell for a script, parameters or workingDirectory");
  if (typeof command !== "string" || !command.trim() || command.length > 32768 || command.includes("\0")) throw sessionError("WINDOWS_COMMAND_INVALID", "command must contain 1-32768 characters without NUL");
  if (workingDirectory != null && (typeof workingDirectory !== "string" || !workingDirectory || /[\0\r\n]/.test(workingDirectory))) throw sessionError("WINDOWS_COMMAND_INVALID", "workingDirectory must be a literal Windows directory path");
  if (parameters != null && (shell === "cmd" || typeof parameters !== "object" || Array.isArray(parameters))) throw sessionError("WINDOWS_COMMAND_INVALID", "parameters must be an object for a PowerShell script; CMD accepts a complete batch script");
  for (const [key, value] of Object.entries(parameters ?? {})) {
    const scalar = item => item === null || ["string", "number", "boolean"].includes(typeof item);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key) || !(scalar(value) || Array.isArray(value) && value.every(scalar))) throw sessionError("WINDOWS_COMMAND_INVALID", "parameters must have simple named scalar or scalar-array values");
  }
  const input = JSON.stringify({ command, parameters: parameters ?? {}, workingDirectory: workingDirectory ?? null, shell });
  if (Buffer.byteLength(input) > 131072) throw sessionError("WINDOWS_COMMAND_INVALID", "Windows command payload exceeds 128 KiB");
  return { command: `${shell === "pwsh" ? "pwsh.exe" : "powershell.exe"} -NoLogo -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand ${encoded(bootstrap)}`, input, encoding: "utf-8", workingDirectory: workingDirectory ?? null, shell };
}

export function windowsProbeCommand() {
  return buildWindowsCommand({ shell: "windows-powershell", command: String.raw`
$os=Get-CimInstance Win32_OperatingSystem
$self=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
$parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$self.ParentProcessId)
$available=@();foreach($n in @('cmd.exe','powershell.exe','pwsh.exe')) { $c=Get-Command $n -ErrorAction SilentlyContinue;if($c){$available+=@{name=$n;path=$c.Source}} }
@{platform='windows';hostname=[Environment]::MachineName;osName=$os.Caption;osVersion=$os.Version;productType=[int]$os.ProductType;architecture=$os.OSArchitecture;cwd=(Get-Location).Path;probeShell=$PSVersionTable.PSVersion.ToString();parentShell=$parent.ExecutablePath;availableShells=$available;execEncoding='utf-8'}|ConvertTo-Json -Depth 4 -Compress
` });
}
