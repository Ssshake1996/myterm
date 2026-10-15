import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { access, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export const playwrightRoot = () => dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
export const browserInstallerCli = () => join(playwrightRoot(), 'cli.js');

// These executable names follow the pinned Playwright Chrome for Testing layout.
// Browser revisions always come from that installed package, never from a latest-version lookup.
export function browserRuntimeMetadata({ packageRoot = playwrightRoot(), platform = process.platform, arch = process.arch } = {}) {
  const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const { browsers } = JSON.parse(readFileSync(join(packageRoot, 'browsers.json'), 'utf8'));
  const names = ['chromium', 'chromium-headless-shell', 'ffmpeg', ...(platform === 'win32' ? ['winldd'] : [])];
  const selected = names.map(name => {
    const browser = browsers.find(item => item.name === name);
    if (!browser) throw new Error(`Playwright runtime metadata is missing ${name}`);
    return { name, revision: browser.revision, directory: `${name.replaceAll('-', '_')}-${browser.revision}`, ...(browser.browserVersion ? { browserVersion: browser.browserVersion } : {}) };
  });
  const target = platform === 'win32' && arch === 'x64' ? 'win64' : platform === 'darwin' ? `mac-${arch}` : platform === 'linux' ? (arch === 'x64' ? 'linux64' : `linux-${arch}`) : undefined;
  if (!target) throw new Error(`Unsupported Chromium runtime platform: ${platform}/${arch}`);
  const full = platform === 'darwin' ? [`chrome-${target}`, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'] : [`chrome-${target}`, platform === 'win32' ? 'chrome.exe' : 'chrome'];
  const shell = [`chrome-headless-shell-${target}`, platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'];
  return { schema: 1, playwrightVersion: version, platform, arch, browsers: selected, executables: { window: join(selected[0].directory, ...full), embedded: join(selected[1].directory, ...shell) } };
}

export const browserRuntimeDirectory = (root, metadata) => join(root, 'runtimes', `playwright-${metadata.playwrightVersion}-${metadata.platform}-${metadata.arch}`);
const exists = path => access(path).then(() => true, () => false);

export async function writeBrowserRuntimeManifest(directory, metadata) {
  for (const relative of Object.values(metadata.executables)) {
    if (!await exists(join(directory, relative))) throw new Error('Chromium installation is incomplete; both the window browser and Headless Shell are required');
  }
  const temporary = join(directory, `runtime.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n');
  await rename(temporary, join(directory, 'runtime.json'));
}

export async function inspectBrowserRuntime({ root, chromium, metadata = browserRuntimeMetadata() }) {
  const directory = browserRuntimeDirectory(root, metadata);
  let managedStatus = 'missing';
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
    managedStatus = JSON.stringify(manifest) === JSON.stringify(metadata) ? 'ready' : 'mismatch';
  } catch (error) { if (error.code !== 'ENOENT') managedStatus = 'invalid'; }
  const full = chromium.executablePath();
  let cache = dirname(full);
  while (basename(cache) !== metadata.browsers[0].directory && dirname(cache) !== cache) cache = dirname(cache);
  cache = basename(cache) === metadata.browsers[0].directory ? dirname(cache) : undefined;
  const modes = {};
  for (const mode of ['window', 'embedded']) {
    const managed = join(directory, metadata.executables[mode]);
    const cached = mode === 'window' ? full : cache && join(cache, metadata.executables[mode]);
    if (managedStatus === 'ready' && await exists(managed)) modes[mode] = { ready: true, source: 'managed', executable: managed };
    else if (cached && await exists(cached)) modes[mode] = { ready: true, source: 'cache', executable: cached };
    else modes[mode] = { ready: false, source: 'missing' };
  }
  if (managedStatus === 'ready' && !await Promise.all(Object.values(metadata.executables).map(relative => exists(join(directory, relative)))).then(values => values.every(Boolean))) managedStatus = 'incomplete';
  return { chromium: modes.window.ready && modes.embedded.ready, playwrightVersion: metadata.playwrightVersion, browserVersion: metadata.browsers[0].browserVersion, revision: metadata.browsers[0].revision, managedStatus, modes };
}
