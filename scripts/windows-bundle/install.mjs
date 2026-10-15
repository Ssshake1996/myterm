import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, copyFile, cp, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative, isAbsolute, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function bundlePath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || isAbsolute(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid bundle file path');
  const path = resolve(root, name), inside = relative(resolve(root), path);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Bundle file is outside its directory');
  return path;
}

export async function fileManifest(root, prefix = '') {
  const result = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Bundle must not contain symbolic links');
    if (entry.isDirectory()) result.push(...await fileManifest(root, path + '/'));
    else if (entry.isFile() && path !== 'bundle.json') result.push({ path, sha256: await sha256(join(root, path)) });
  }
  return result;
}

export async function verifyBundle(root) {
  const manifest = JSON.parse(await readFile(join(root, 'bundle.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.platform !== 'win32' || manifest.arch !== 'x64' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.package !== `dsh-remote-ops-v${manifest.version}.tgz` || !Array.isArray(manifest.files)) throw new Error('Invalid Windows bundle manifest');
  const actual = await fileManifest(root), expected = new Map();
  for (const file of manifest.files) {
    bundlePath(root, file.path);
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || expected.has(file.path)) throw new Error('Invalid bundle checksum entry');
    expected.set(file.path, file.sha256);
  }
  for (const required of [manifest.package, 'install.ps1', 'install.mjs', 'browser-runtime/runtime.json']) if (!expected.has(required)) throw new Error(`Bundle is missing ${required}`);
  if (actual.length !== expected.size) throw new Error('Bundle contains missing or unexpected files');
  for (const file of actual) if (expected.get(file.path) !== file.sha256) throw new Error(`Bundle checksum mismatch: ${file.path}`);
  return manifest;
}

export function findDshEntry(explicit, searchPath = process.env.PATH ?? '') {
  if (explicit) {
    const path = resolve(explicit);
    if (!existsSync(path) || !/\.(?:mjs|cjs|js)$/i.test(path)) throw new Error('--dsh-entry must point to the installed DSH JavaScript CLI');
    return path;
  }
  for (const folder of searchPath.split(delimiter)) {
    const entry = join(folder.replace(/^"|"$/g, ''), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (existsSync(entry)) return entry;
  }
  throw new Error('DSH was not found on PATH. Install DSH first, or supply -DshEntry with its lib/bin.js path.');
}

export function parseInstallArgs(argv) {
  const options = { profile: 'web', home: process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), verifyOnly: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--verify-only') options.verifyOnly = true;
    else if (['--profile', '--home', '--dsh-entry'].includes(flag) && argv[index + 1] && !argv[index + 1].startsWith('--')) options[flag === '--dsh-entry' ? 'dshEntry' : flag.slice(2)] = argv[++index];
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(options.profile)) throw new Error('Invalid DSH profile name');
  options.home = resolve(options.home.replace(/^~(?=[\\/])/, homedir()));
  return options;
}

export async function installBundle(options, root = dirname(fileURLToPath(import.meta.url))) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This bundle requires Windows x64');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
  console.log('Verifying bundle checksums…');
  const manifest = await verifyBundle(root);
  if (options.verifyOnly) { console.log(`Bundle v${manifest.version}: all checksums passed.`); return; }
  const entry = findDshEntry(options.dshEntry), env = { ...process.env, DSH_HOME: options.home };
  console.log(`Installing Remote Ops v${manifest.version}\nDSH_HOME: ${options.home}\nProfile: ${options.profile}\nRuntime dependencies may download from the configured npm registry.`);
  // DSH stores a file: reference, so keep the tgz after the downloaded ZIP is removed.
  const packages = join(options.home, 'remote-ops', 'packages');
  await mkdir(packages, { recursive: true });
  const archive = join(packages, manifest.package);
  if (existsSync(archive) && await sha256(archive) !== manifest.files.find(file => file.path === manifest.package).sha256) throw new Error('A different plugin archive already exists with this version; retain it and use a new release version');
  if (!existsSync(archive)) await copyFile(bundlePath(root, manifest.package), archive);
  const result = spawnSync(process.execPath, [entry, 'plugin', '--profile', options.profile, 'add', archive], { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('DSH plugin installation failed. Check npm registry/proxy access and pnpm availability, then rerun this installer.');
  const profile = join(options.home, 'profiles', options.profile);
  const packagePath = createRequire(join(profile, 'package.json')).resolve('@dsh/remote-ops/package.json');
  const installed = JSON.parse(await readFile(packagePath, 'utf8'));
  if (installed.version !== manifest.version) throw new Error('The installed plugin version does not match the bundle');
  const runtime = await import(pathToFileURL(join(dirname(packagePath), 'lib', 'browser-runtime.js')));
  const metadata = runtime.browserRuntimeMetadata();
  const bundledMetadata = JSON.parse(await readFile(join(root, 'browser-runtime', 'runtime.json'), 'utf8'));
  if (JSON.stringify(metadata) !== JSON.stringify(bundledMetadata)) throw new Error('The bundled Chromium version does not match the installed Playwright version');
  const browserRoot = join(options.home, 'remote-ops', 'browser'), destination = runtime.browserRuntimeDirectory(browserRoot, metadata);
  const runtimeFiles = manifest.files.filter(file => file.path.startsWith('browser-runtime/'));
  const verifyRuntime = async directory => {
    for (const file of runtimeFiles) {
      const path = join(directory, file.path.slice('browser-runtime/'.length));
      if (!existsSync(path) || await sha256(path) !== file.sha256) return false;
    }
    return true;
  };
  if (await verifyRuntime(destination)) console.log('Matching Chromium files already installed; reusing them.');
  else {
    await mkdir(dirname(destination), { recursive: true });
    const incoming = join(dirname(destination), `.incoming-${randomUUID()}`);
    await cp(join(root, 'browser-runtime'), incoming, { recursive: true });
    if (!await verifyRuntime(incoming)) throw new Error('Copied browser files failed verification; the previous runtime was retained');
    const backup = `${destination}.backup-${randomUUID()}`;
    const hadPrevious = existsSync(destination);
    if (hadPrevious) await rename(destination, backup);
    try { await rename(incoming, destination); }
    catch (error) { if (hadPrevious) await rename(backup, destination); throw error; }
    if (hadPrevious) console.log(`Previous runtime retained at ${backup}`);
  }
  const library = await import(pathToFileURL(join(dirname(createRequire(packagePath).resolve('playwright-core/package.json')), 'index.mjs')));
  const status = await runtime.inspectBrowserRuntime({ root: browserRoot, chromium: library.chromium });
  for (const mode of ['embedded', 'window']) {
    if (!status.modes[mode].ready || status.modes[mode].source !== 'managed') throw new Error(`Managed browser is not ready for ${mode}`);
    console.log(`Checking ${mode} browser${mode === 'window' ? ' (a test window opens briefly)' : ''}…`);
    const browser = await library.chromium.launch({ executablePath: status.modes[mode].executable, headless: mode === 'embedded' });
    try { const page = await browser.newPage(); await page.setContent('<button onclick="this.textContent=\'ready\'">check</button>'); await page.getByRole('button').click(); if (await page.getByRole('button').textContent() !== 'ready') throw new Error(`Browser interaction failed: ${mode}`); }
    finally { await browser.close(); }
  }
  console.log(`Remote Ops v${manifest.version}: plugin view and independent window are ready.\nRestart DSH using the same DSH_HOME and profile, refresh the webpage, and confirm v${manifest.version}. Login profiles and site/flow settings were retained.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await installBundle(parseInstallArgs(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
