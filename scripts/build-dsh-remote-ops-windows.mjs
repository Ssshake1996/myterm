#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, cp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { browserRuntimeMetadata, browserInstallerCli, playwrightRoot, writeBrowserRuntimeManifest } from '../integrations/dsh-remote-ops/lib/browser-runtime.js';
import { fileManifest, sha256, verifyBundle } from './windows-bundle/install.mjs';

export const windowsBundleName = version => `dsh-remote-ops-v${version}-windows-x64.zip`;
export async function buildWindowsBundle({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output, browserCache } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 bundle on Windows x64');
  output = resolve(output ?? join(root, 'dist-release'));
  browserCache = resolve(browserCache ?? join(root, '.cache', 'remote-ops-windows'));
  const plugin = join(root, 'integrations', 'dsh-remote-ops'), pkg = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
  await mkdir(output, { recursive: true });
  const packageName = `dsh-remote-ops-v${pkg.version}.tgz`, packagePath = join(output, packageName);
  if (!existsSync(packagePath)) {
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!existsSync(npmCli)) throw new Error('The npm CLI next to Node.js was not found');
    const packed = spawnSync(process.execPath, [npmCli, 'pack', '--silent', '--pack-destination', output], { cwd: plugin, encoding: 'utf8' });
    if (packed.error || packed.status !== 0) throw packed.error ?? new Error(packed.stderr);
    await copyFile(join(output, packed.stdout.trim().split(/\r?\n/).at(-1)), packagePath);
  }
  const metadata = browserRuntimeMetadata();
  console.log(`Preparing Playwright ${metadata.playwrightVersion}, Chromium ${metadata.browsers[0].browserVersion} (revision ${metadata.browsers[0].revision})`);
  const installed = spawnSync(process.execPath, [browserInstallerCli(), 'install', 'chromium'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache }, stdio: 'inherit', windowsHide: true });
  if (installed.error || installed.status !== 0) throw installed.error ?? new Error('Chromium preparation failed');
  await writeBrowserRuntimeManifest(browserCache, metadata);
  const stage = join(output, `.windows-${pkg.version}-${randomUUID()}`), runtime = join(stage, 'browser-runtime');
  await mkdir(runtime, { recursive: true });
  await copyFile(packagePath, join(stage, packageName));
  for (const name of ['install.ps1', 'install.mjs', 'README.zh-CN.md']) await copyFile(join(root, 'scripts', 'windows-bundle', name), join(stage, name));
  for (const browser of metadata.browsers) await cp(join(browserCache, browser.directory), join(runtime, browser.directory), { recursive: true });
  await copyFile(join(browserCache, 'runtime.json'), join(runtime, 'runtime.json'));
  await copyFile(join(playwrightRoot(), 'LICENSE'), join(stage, 'PLAYWRIGHT-LICENSE.txt'));
  await copyFile(join(playwrightRoot(), 'NOTICE'), join(stage, 'PLAYWRIGHT-NOTICE.txt'));
  await copyFile(join(playwrightRoot(), 'ThirdPartyNotices.txt'), join(stage, 'PLAYWRIGHT-ThirdPartyNotices.txt'));
  await writeFile(join(stage, 'bundle.json'), JSON.stringify({ schema: 1, version: pkg.version, platform: 'win32', arch: 'x64', package: packageName, playwrightVersion: metadata.playwrightVersion, files: await fileManifest(stage) }, null, 2) + '\n');
  await verifyBundle(stage);
  const zipPath = join(output, windowsBundleName(pkg.version));
  // Paths are passed as PowerShell positional arguments, never interpolated as shell code.
  const zipScript = join(root, 'scripts', 'windows-bundle', 'pack.ps1');
  const zip = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', zipScript, '-Source', stage, '-Destination', zipPath], { stdio: 'inherit', windowsHide: true });
  if (zip.error || zip.status !== 0) throw zip.error ?? new Error('ZIP creation failed');
  const sums = join(output, `SHA256SUMS-dsh-remote-ops-v${pkg.version}.txt`);
  await writeFile(sums, `${await sha256(packagePath)}  ${packageName}\n${await sha256(zipPath)}  ${windowsBundleName(pkg.version)}\n`);
  console.log(`Windows bundle: ${zipPath}`);
  return { zipPath, stage, packagePath };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = { '--output': 'output', '--browser-cache': 'browserCache' }[process.argv[i]];
      if (!key || !process.argv[i + 1]) throw new Error('Usage: node scripts/build-dsh-remote-ops-windows.mjs [--output directory] [--browser-cache directory]');
      options[key] = process.argv[i + 1];
    }
    await buildWindowsBundle(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
