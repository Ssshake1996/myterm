import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile, rename, cp, rm } from 'node:fs/promises';
import { dirname, join, relative, basename, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { browserRuntimeMetadata, browserInstallerCli, bundledBrowserRoot, inspectBundledBrowser } from '../lib/browser-runtime.js';
import { chromium } from 'playwright-core';
import { browserFileHash, browserFileParts, browserPartBytes } from '../lib/embedded-browser.js';

const metadata = browserRuntimeMetadata(), directory = join(bundledBrowserRoot, `${metadata.platform}-${metadata.arch}`);
async function writeManifest(directory, manifest) {
  const originals = [];
  for (const file of manifest.files) {
    const source = join(directory, file.path);
    const hash = await browserFileHash(source);
    if (file.sha256 && file.sha256 !== hash) throw new Error(`Browser file checksum mismatch: ${file.path}`);
    file.sha256 = hash;
    if (file.size <= browserPartBytes) continue;
    file.partSize = browserPartBytes;
    file.mode = file.path === manifest.executable || ((await stat(source)).mode & 0o111) ? 0o755 : 0o644;
    let offset = 0;
    for (const part of browserFileParts(file)) {
      const target = join(directory, part.path);
      const temp = target + '.tmp';
      try {
        await pipeline(createReadStream(source, { start: offset, end: offset + part.size - 1 }), createWriteStream(temp));
        await rename(temp, target);
      } finally {
        await rm(temp, { force: true });
      }
      offset += part.size;
    }
    originals.push(source);
  }
  manifest.schema = 2;
  const temporary = join(directory, `runtime.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
  await rename(temporary, join(directory, 'runtime.json'));
  for (const source of originals) await rm(source);
}
async function finishExisting(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
  if (manifest.schema === 1) return writeManifest(directory, manifest);
  // A build may have stopped after publishing the manifest but before removing the original.
  for (const file of manifest.files.filter(file => file.partSize)) await rm(join(directory, file.path), { force: true });
}
const ready = await inspectBundledBrowser(metadata);
if (process.argv.includes('--check')) {
  if (!ready.ready && ready.status !== 'preparing') throw new Error(`Bundled internal browser is ${ready.reason}. Run npm run bundle:browser before packing.`);
  console.log(`Bundled internal browser verified: ${metadata.platform}/${metadata.arch} Playwright ${metadata.playwrightVersion}`);
} else if (ready.ready || ready.status === 'preparing') {
  await finishExisting(directory);
  await writeFile(join(bundledBrowserRoot, '.npmignore'), '**/.links/\n**/*.tmp\n');
  console.log('Bundled internal browser already matches the installed Playwright.');
} else {
  // Only replace this platform's generated runtime, never browser profiles or caches.
  if (!resolve(directory).startsWith(resolve(bundledBrowserRoot) + sep)) throw new Error('Unsafe runtime directory');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(bundledBrowserRoot, '.npmignore'), '**/.links/\n**/*.tmp\n');
  // Reuse a complete matching cache when available; no global browser state is changed.
  let cache = dirname(chromium.executablePath());
  while (basename(cache) !== metadata.browsers[0].directory && dirname(cache) !== cache) cache = dirname(cache);
  cache = basename(cache) === metadata.browsers[0].directory ? dirname(cache) : null;
  for (const browser of metadata.browsers.filter(item => item.name !== 'chromium')) {
    if (!cache) break;
    const source = join(cache, browser.directory);
    if (await stat(join(source, 'INSTALLATION_COMPLETE')).then(value => value.isFile(), () => false)) await cp(source, join(directory, browser.directory), { recursive: true, force: true });
  }
  const executable = metadata.executables.embedded.replaceAll('\\', '/');
  const components = metadata.browsers.filter(item => item.name !== 'chromium');
  if (!(await Promise.all(components.map(browser => stat(join(directory, browser.directory, 'INSTALLATION_COMPLETE')).then(value => value.isFile(), () => false)))).every(Boolean)) {
    const result = spawnSync(process.execPath, [browserInstallerCli(), 'install', 'chromium', '--only-shell'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: directory }, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('Internal browser preparation failed. Check the installation network/proxy and retry npm run bundle:browser.');
  }
  const launch = spawnSync(join(directory, executable), ['--version'], { windowsHide: true, timeout: 15000, encoding: 'utf8' });
  if (launch.error || launch.status !== 0) throw new Error('Prepared Chromium cannot start. Check the operating-system browser libraries and retry npm run bundle:browser.');
  const files = [];
  async function walk(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (item.name === '.links' || item.name === 'runtime.json' || item.name.endsWith('.tmp')) continue;
      const full = join(path, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.isFile()) files.push({ path: relative(directory, full).replaceAll('\\', '/'), size: (await stat(full)).size });
    }
  }
  await walk(directory); files.sort((a,b)=>a.path.localeCompare(b.path));
  if (!files.some(file => file.path === executable && file.size > 0)) throw new Error('Internal browser installation is incomplete');
  const manifest = { schema: 1, platform: metadata.platform, arch: metadata.arch, playwrightVersion: metadata.playwrightVersion, executable, files };
  await writeManifest(directory, manifest);
  console.log(`Bundled internal browser prepared: ${metadata.platform}/${metadata.arch}, ${files.length} files.`);
}

// Release packages can include another platform's prebuilt runtime as well.
if (!process.argv.includes('--check')) {
  for (const platform of ['win32', 'linux'].filter(platform => platform !== metadata.platform)) {
    const other = browserRuntimeMetadata({ platform, arch: 'x64' });
    const otherDir = join(bundledBrowserRoot, `${platform}-x64`);
    const entry = await stat(otherDir).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!entry) continue;
    const inspected = await inspectBundledBrowser(other);
    if (!inspected.ready && inspected.status !== 'preparing') throw new Error(`Incomplete ${platform} browser runtime: ${inspected.error}`);
    await finishExisting(otherDir);
  }
}
