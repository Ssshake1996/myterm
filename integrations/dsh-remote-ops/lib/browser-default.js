import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 } from 'node:path';
import { browserError } from './browser-steps.js';

// Query the current user's Shell association; never execute its command line or change defaults.
export async function windowsDefaultBrowser(protocol, { platform = process.platform, execFile = promisify(execFileCallback) } = {}) {
  if (!['http:', 'https:'].includes(protocol)) throw browserError('BROWSER_URL_INVALID', 'Use HTTP(S)');
  if (platform !== 'win32') throw browserError('BROWSER_DEFAULT_UNSUPPORTED', 'System browser selection currently supports Windows. Select Chromium, Chrome or Edge explicitly in browser settings.');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RemoteOpsAssociation {
  [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
  public static extern int AssocQueryString(uint flags, uint str, string assoc, string extra, StringBuilder output, ref uint length);
}
'@
$length = [uint32]32768
$output = New-Object System.Text.StringBuilder 32768
$result = [RemoteOpsAssociation]::AssocQueryString(0x1000, 2, '${protocol.slice(0, -1)}', 'open', $output, [ref]$length)
if ($result -ne 0) { throw 'Cannot read the default URL handler' }
[Console]::Write($output.ToString())
`;
  let executablePath;
  try {
    const shell = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = await execFile(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 65536 });
    executablePath = result.stdout.trim().replace(/^\uFEFF/, '');
  } catch { throw browserError('BROWSER_DEFAULT_UNAVAILABLE', 'Cannot read the Windows default browser. Check Windows default apps or select Chromium, Chrome or Edge explicitly in browser settings.'); }
  const browser = { 'chrome.exe': 'chrome', 'msedge.exe': 'msedge' }[win32.basename(executablePath).toLowerCase()];
  if (!win32.isAbsolute(executablePath) || !browser || /[\r\n\x00]/.test(executablePath)) throw browserError('BROWSER_DEFAULT_UNSUPPORTED', 'The Windows default browser is not a supported installed Chrome/Edge browser. Choose a supported browser in plugin settings; no fallback browser was opened.');
  return { browser, executablePath, source: 'system' };
}
