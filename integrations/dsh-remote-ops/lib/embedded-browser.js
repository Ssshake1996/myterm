import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const bundledBrowserRoot = fileURLToPath(new URL('../browser/runtime/', import.meta.url));
const run = promisify(execFile);
const probeBrowser = file => run(file, ['--version'], { windowsHide: true, timeout: 15000, maxBuffer: 65536 });

export async function browserFileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function userCache() {
  const local = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(local, 'myterm', 'cr');
}

function failure(reason, message) {
  return { source: 'bundled', ready: false, status: 'failed', reason, error: message };
}

async function readBundle(metadata, base) {
  const directory = join(base, `${metadata.platform}-${metadata.arch}`);
  const raw = await readFile(join(directory, 'runtime.json'), 'utf8');
  const manifest = JSON.parse(raw);
  const executable = metadata.executables.embedded.replaceAll('\\', '/');
  if (manifest.schema !== 1 || manifest.platform !== metadata.platform || manifest.arch !== metadata.arch ||
      manifest.playwrightVersion !== metadata.playwrightVersion || manifest.executable !== executable || !Array.isArray(manifest.files)) {
    throw Object.assign(new Error('随包 Chromium 版本或平台不匹配'), { reason: 'mismatch' });
  }
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || /[:\\\0]/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..') ||
        !Number.isSafeInteger(file.size) || file.size < 0 || (file.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(file.sha256))) {
      throw new Error('随包 Chromium 文件清单无效');
    }
  }
  if (!manifest.files.some(file => file.path === executable && file.size > 0)) throw new Error('清单缺少 Chromium 可执行文件');
  return { directory, executable, files: manifest.files, fingerprint: createHash('sha256').update(raw).digest('hex').slice(0, 16) };
}

async function matches(directory, files, source) {
  for (const file of files) {
    const path = join(directory, file.path);
    const entry = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!entry?.isFile() || entry.size !== file.size) return false;
    if (source) {
      // Earlier distribution manifests contain sizes only. Use their bundled bytes as the reference.
      const expected = file.sha256 ?? await browserFileHash(join(source, file.path));
      if (await browserFileHash(path) !== expected) return false;
    }
  }
  return true;
}

const unavailable = error => failure(error.reason ?? (error.code === 'ENOENT' ? 'missing' : 'invalid'), error.message);
const ready = executable => ({ source: 'bundled', ready: true, status: 'ready', executable });

export async function inspectBundledBrowser(metadata, base = bundledBrowserRoot) {
  try {
    const bundle = await readBundle(metadata, base);
    if (!await matches(bundle.directory, bundle.files)) return failure('incomplete', '随包 Chromium 文件不完整');
    return ready(join(bundle.directory, bundle.executable));
  } catch (error) { return unavailable(error); }
}

// Publish a verified generation with an atomic pointer. Another DSH profile can
// still be running an older generation, especially while Windows holds its DLLs.
export async function prepareEmbeddedBrowser(metadata, { bundleRoot = bundledBrowserRoot, cacheRoot = userCache(), probe = probeBrowser, onPrepare } = {}) {
  try {
    const bundle = await readBundle(metadata, bundleRoot);
    const revision = metadata.browsers.find(item => item.name === 'chromium-headless-shell').revision;
    const root = join(cacheRoot, `${metadata.platform}-${metadata.arch}-${revision}-${bundle.fingerprint}`);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const pointer = join(root, 'active');
    const active = await readFile(pointer, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (/^r-[a-zA-Z0-9]{6}$/.test(active)) {
      const directory = join(root, active), executable = join(directory, bundle.executable);
      if (await matches(directory, bundle.files, bundle.directory)) {
        try { await probe(executable); return ready(executable); }
        catch { /* Restore executable permissions and files into a fresh generation. */ }
      }
    }
    onPrepare?.();
    const stage = await mkdtemp(join(root, 'r-'));
    const temporary = join(root, `active-${randomUUID()}.tmp`);
    let published = false;
    try {
      for (const file of bundle.files) {
        const dest = join(stage, file.path);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(join(bundle.directory, file.path), dest);
      }
      if (!await matches(stage, bundle.files, bundle.directory)) throw new Error('随包 Chromium 校验失败，请检查插件安装包');
      const executable = join(stage, bundle.executable);
      await probe(executable);
      await writeFile(temporary, basename(stage), { mode: 0o600 });
      await rename(temporary, pointer);
      published = true;
      return ready(executable);
    } finally {
      if (!published) await rm(stage, { recursive: true, force: true });
      await rm(temporary, { force: true });
    }
  } catch (error) { return unavailable(error); }
}
