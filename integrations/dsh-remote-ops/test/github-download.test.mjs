import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadRelease, fetchLatestRelease, UPDATE_PACKAGE } from '../lib/release.js';
import { readGitHubDownload, downloadGitHubRelease, hashUpdateFile } from '../lib/github-download.js';
import { withUpdates } from '../lib/state/updates.js';
import { PLUGIN_VERSION, RELEASE_REPOSITORY } from '../lib/version.js';

const parts = PLUGIN_VERSION.split('.').map(Number); parts[2]++; const version = parts.join('.');
const name = `dsh-remote-ops-v${version}.tgz`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function archive(extra = {}) {
  const json = Buffer.from(JSON.stringify({ name: UPDATE_PACKAGE, version, dsh: { bundle: {} }, description: randomBytes(24000).toString('hex'), ...extra }));
  const header = Buffer.alloc(512); header.write('package/package.json'); header.write(json.length.toString(8).padStart(11, '0') + '\0', 124); header[156] = 48;
  return gzipSync(Buffer.concat([header, json, Buffer.alloc((512 - json.length % 512) % 512), Buffer.alloc(1024)]));
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'remote-github-download-'));
  const f = { root, bytes: archive(), calls: [], requests: [], etag: '"asset-one"', cutoff: 4096, drops: 0 };
  const server = createServer(async (req, res) => {
    f.requests.push({ path: req.url, range: req.headers.range, ifRange: req.headers['if-range'] });
    if (req.url.includes('.txt')) return res.end(`${sha(f.bytes)}  ${name}\n`);
    if (f.serve) return f.serve(req, res);
    const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? '')?.[1] ?? 0);
    const status = req.headers.range && !f.ignoreRange ? 206 : 200;
    const start = status === 200 ? 0 : offset;
    res.writeHead(status, { 'Content-Length': f.bytes.length - start, ETag: f.etag,
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${f.bytes.length - 1}/${f.bytes.length}` } : {}) });
    if (f.drops-- > 0) {
      res.write(f.bytes.subarray(start, start + f.cutoff));
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && await stat(join(root, 'updates/github/package.part')).then(value => value.size).catch(() => 0) < Math.min(start + f.cutoff, f.bytes.length)) await pause(10);
      res.destroy();
    }
    else res.end(f.bytes.subarray(start));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  f.release = { currentVersion: PLUGIN_VERSION, latestVersion: version, updateAvailable: true, source: 'github', assetName: name, assetId: 123, assetSize: f.bytes.length,
    assetUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/download/dsh-remote-ops-v${version}/${name}`,
    checksumUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/download/dsh-remote-ops-v${version}/SHA256SUMS-dsh-remote-ops-v${version}.txt` };
  f.fetchImpl = async (url, options) => {
    f.calls.push({ url, headers: options.headers });
    if (url.startsWith('https://github.com/') && url.endsWith('.tgz')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset.tgz?signature=fresh-' + f.calls.length } });
    return fetch(local + new URL(url).pathname, options);
  };
  f.options = { fetchImpl: f.fetchImpl, retryDelays: [0, 0, 0] };
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return f;
}

test('GitHub metadata retains size, asset identity and digest', async () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  const release = await fetchLatestRelease({ source: 'github' }, { fetchImpl: async () => Response.json({ tag_name: 'dsh-remote-ops-v' + version, assets: [name, `SHA256SUMS-dsh-remote-ops-v${version}.txt`].map(name => ({ name, id: 123, size: 456, digest, updated_at: '2026-11-22T00:00:00Z', browser_download_url: `https://github.com/${RELEASE_REPOSITORY}/releases/download/dsh-remote-ops-v${version}/${name}` })) }) });
  assert.equal(release.assetId, 123); assert.equal(release.assetSize, 456); assert.equal(release.assetDigest, digest);
});

test('real connection loss streams partial bytes to disk, retries via fresh redirect and validates the finished archive', async t => {
  const f = await fixture(t); f.drops = 1; const progress = [], phases = [];
  const result = await downloadRelease(f.release, f.root, { ...f.options, onProgress: item => progress.push(item), onPhase: item => phases.push(item) });
  assert.equal(await hashUpdateFile(result.path), sha(f.bytes));
  const assets = f.requests.filter(item => item.path.endsWith('.tgz'));
  assert.equal(assets.length, 2); assert.equal(assets[1].range, `bytes=${f.cutoff}-`); assert.equal(assets[1].ifRange, f.etag);
  assert.equal(f.calls.filter(item => item.url === f.release.assetUrl).length, 2);
  assert.ok(progress.some(item => item.status === 'retrying' && item.downloadedBytes === f.cutoff));
  assert.equal(progress.at(-1).downloadedBytes, f.bytes.length); assert.equal(progress.at(-1).status, 'verified');
  assert.ok(phases.includes('download-retrying')); assert.equal((await readGitHubDownload(f.root)).status, 'verified');
  const count = f.requests.length; await downloadRelease(f.release, f.root, f.options);
  assert.equal(f.requests.length, count + 1, 'only recheck checksum; never redownload a verified package');
});

test('exhausted retries and a fresh state instance retain the exact offset; status reads make no network calls', async t => {
  const f = await fixture(t); f.drops = 1;
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, retryDelays: [] }), /UPDATE_DOWNLOAD_FAILED/);
  const saved = await readGitHubDownload(f.root); assert.equal(saved.downloadedBytes, f.cutoff);
  const state = new (withUpdates(class {}))(); state.base = f.root;
  const before = f.calls.length, status = await state.updateStatus(); assert.equal(f.calls.length, before);
  assert.equal(status.download.resumable, true); assert.equal(status.download.downloadedBytes, f.cutoff); assert.equal(status.phase, 'download-paused');
  await downloadRelease(saved.release, f.root, f.options);
  assert.equal(f.requests.at(-1).range, `bytes=${f.cutoff}-`);
});

test('a verified cache removed from disk is downloaded again rather than trapping continue-install', async t => {
  const f = await fixture(t); const first = await downloadRelease(f.release, f.root, f.options); await unlink(first.path);
  assert.equal((await readGitHubDownload(f.root)).status, 'partial');
  const result = await downloadRelease(f.release, f.root, f.options); assert.equal(await hashUpdateFile(result.path), sha(f.bytes));
  assert.equal(f.requests.filter(item => item.path.endsWith('.tgz')).length, 2); assert.equal(f.requests.at(-1).range, undefined);
});

test('200 on a Range request replaces the partial file instead of appending it', async t => {
  const f = await fixture(t); f.drops = 1;
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, retryDelays: [] })); f.ignoreRange = true;
  const progress = []; const result = await downloadRelease(f.release, f.root, { ...f.options, onProgress: item => progress.push(item) });
  assert.equal((await stat(result.path)).size, f.bytes.length); assert.equal(await hashUpdateFile(result.path), sha(f.bytes));
  assert.ok(progress.some(item => /未接受续传/.test(item.message)));
});

for (const condition of ['wrong-offset', 'changed-etag', '416']) test(`invalid resume (${condition}) restarts safely before appending`, async t => {
  const f = await fixture(t); f.drops = 1;
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, retryDelays: [] }));
  f.serve = (req, res) => {
    f.serve = null;
    if (condition === '416') return res.writeHead(416, { 'Content-Range': 'bytes */1' }).end();
    res.writeHead(206, { ETag: condition === 'changed-etag' ? '"different"' : f.etag, 'Content-Range': `bytes ${condition === 'wrong-offset' ? 1 : f.cutoff}-${f.bytes.length - 1}/${f.bytes.length}` }); res.end(f.bytes.subarray(f.cutoff));
  };
  const result = await downloadRelease(f.release, f.root, f.options); assert.equal(await hashUpdateFile(result.path), sha(f.bytes));
  assert.equal(f.requests.at(-1).range, undefined);
});

test('a completed partial file is verified without another request; 416 at actual length also verifies', async t => {
  const f = await fixture(t); f.drops = 1;
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, retryDelays: [] }));
  const directory = join(f.root, 'updates/github'); await writeFile(join(directory, 'package.part'), f.bytes);
  const before = f.requests.length; await downloadRelease(f.release, f.root, f.options); assert.equal(f.requests.length, before + 1);
  // Simulate a chunked earlier response whose total length was unknown.
  const job = await readGitHubDownload(f.root); job.status = 'partial'; job.totalBytes = null;
  await writeFile(join(directory, 'job.json'), JSON.stringify(job)); await writeFile(join(directory, 'package.part'), f.bytes);
  f.serve = (_req, res) => res.writeHead(416, { 'Content-Range': `bytes */${f.bytes.length}` }).end();
  await downloadRelease({ ...f.release, assetSize: undefined }, f.root, f.options);
});

test('progressive slow traffic has no full-body timeout; a stalled body times out and retains bytes', async t => {
  const f = await fixture(t);
  f.serve = async (_req, res) => {
    res.writeHead(200, { ETag: f.etag, 'Content-Length': f.bytes.length });
    for (let i = 0; i < f.bytes.length; i += 4096) { res.write(f.bytes.subarray(i, i + 4096)); await pause(25); }
    res.end();
  };
  const started = Date.now(); await downloadRelease(f.release, f.root, { ...f.options, connectTimeoutMs: 100, idleTimeoutMs: 120 }); assert.ok(Date.now() - started > 120);
  f.serve = (_req, res) => { res.writeHead(200, { ETag: f.etag, 'Content-Length': f.bytes.length }); res.write(f.bytes.subarray(0, f.cutoff)); };
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, restartDownload: true, idleTimeoutMs: 50, retryDelays: [] }), /UPDATE_DOWNLOAD_TIMEOUT/);
  assert.equal((await readGitHubDownload(f.root)).downloadedBytes, f.cutoff);
});

test('HTTP errors distinguish transient failures, permanent errors and redacted signed redirects', async t => {
  const f = await fixture(t); let attempts = 0;
  f.serve = (_req, res) => { attempts++; res.writeHead(503, { 'Retry-After': '0' }).end('temporarily unavailable'); };
  await assert.rejects(downloadRelease(f.release, f.root, f.options), error => { assert.equal(error.requestFailure.status, 503); assert.doesNotMatch(JSON.stringify(error.requestFailure), /fresh-\d/); return true; });
  assert.equal(attempts, 4);
  attempts = 0; f.serve = (_req, res) => { attempts++; res.writeHead(404).end('missing'); };
  await assert.rejects(downloadRelease(f.release, f.root, f.options), /HTTP 404/); assert.equal(attempts, 1);
});

test('Retry-After is honored and only one writer can use the cache', async t => {
  const f = await fixture(t); let calls = 0, retriedAt, firstAt;
  f.serve = (_req, res) => {
    if (!calls++) { firstAt = Date.now(); res.writeHead(429, { 'Retry-After': '1' }).end(); }
    else { retriedAt = Date.now(); res.writeHead(200, { ETag: f.etag, 'Content-Length': f.bytes.length }).end(f.bytes); }
  };
  const pending = downloadRelease(f.release, f.root, f.options); await pause(80);
  await assert.rejects(downloadRelease(f.release, f.root, f.options), /UPDATE_BUSY/);
  await pending; assert.ok(retriedAt - firstAt >= 950);
});

test('new asset identity/checksum and explicit restart never append old data', async t => {
  const f = await fixture(t); f.drops = 1;
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, retryDelays: [] }));
  f.bytes = archive({ marker: 'new asset' }); f.release.assetSize = f.bytes.length; f.release.assetId++;
  await downloadRelease(f.release, f.root, f.options); assert.equal(f.requests.at(-1).range, undefined);
  f.drops = 1; await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, restartDownload: true, retryDelays: [] }));
  await downloadRelease(f.release, f.root, { ...f.options, restartDownload: true }); assert.equal(f.requests.at(-1).range, undefined);
});

test('checksum/package mismatch never yields an install path and retires corrupt partial data', async t => {
  const f = await fixture(t);
  f.serve = (_req, res) => res.end(Buffer.alloc(f.bytes.length, 65));
  await assert.rejects(downloadRelease(f.release, f.root, f.options), /UPDATE_CHECKSUM_MISMATCH/);
  assert.equal((await readGitHubDownload(f.root)).status, 'invalid');
  await assert.rejects(stat(join(f.root, 'updates/github/package.part')), { code: 'ENOENT' });
  f.serve = null; f.bytes = archive({ name: 'wrong-package' }); f.release.assetSize = f.bytes.length;
  await assert.rejects(downloadRelease(f.release, f.root, f.options), /UPDATE_PACKAGE_INVALID/);
});

test('aborting a live transfer preserves written bytes and releases the writer lock', async t => {
  const f = await fixture(t), controller = new AbortController();
  f.serve = (_req, res) => { res.writeHead(200, { ETag: f.etag, 'Content-Length': f.bytes.length }); res.write(f.bytes.subarray(0, f.cutoff)); setTimeout(() => controller.abort(), 40); };
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, signal: controller.signal }), /UPDATE_CANCELLED/);
  assert.equal((await readGitHubDownload(f.root)).downloadedBytes, f.cutoff); f.serve = null;
  await downloadRelease(f.release, f.root, f.options); assert.equal(f.requests.at(-1).range, `bytes=${f.cutoff}-`);
});

test('unknown content length stays indeterminate; final size is published after verification', async t => {
  const f = await fixture(t), progress = []; f.release.assetSize = undefined;
  f.serve = async (_req, res) => { res.writeHead(200, { ETag: f.etag }); res.write(f.bytes.subarray(0, 4096)); await pause(20); res.end(f.bytes.subarray(4096)); };
  await downloadRelease(f.release, f.root, { ...f.options, onProgress: item => progress.push(item) });
  assert.ok(progress.some(item => item.status === 'downloading' && item.totalBytes === null)); assert.equal(progress.at(-1).totalBytes, f.bytes.length);
});

test('corrupt cache metadata cannot select a path or host, and a dead process lock can be recovered', async t => {
  const f = await fixture(t), directory = join(f.root, 'updates/github'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'job.json'), JSON.stringify({ schemaVersion: 1, release: { ...f.release, assetName: '../../private' } })); assert.equal(await readGitHubDownload(f.root), null);
  await writeFile(join(directory, 'download.lock'), JSON.stringify({ pid: 2147483647 }));
  await downloadRelease(f.release, f.root, f.options);
});

test('resume through state pins the saved version and dispatches one DSH install, with no Latest check', async t => {
  const f = await fixture(t); f.drops = 1;
  await assert.rejects(downloadRelease(f.release, f.root, { ...f.options, retryDelays: [] }));
  const state = new (withUpdates(class {}))(); state.base = f.root;
  let installed = PLUGIN_VERSION, installs = 0;
  state.updateManager = { listBundles: async () => [{ name: UPDATE_PACKAGE, version: installed, installed: true }], installBundle: async path => { assert.equal(await hashUpdateFile(path), sha(f.bytes)); installs++; installed = version; return { application: 'applied' }; } };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { assert.notEqual(new URL(url).host, 'api.github.com'); return f.fetchImpl(url, options); };
  // f.fetchImpl's local request must bypass the global override.
  const adapter = f.fetchImpl; f.fetchImpl = async (url, options) => {
    if (url.startsWith('http://127.0.0.1:')) return original(url, options);
    return adapter(url, options);
  };
  try {
    const pending = state.upgrade({ resume: true }); assert.equal(state.upgrade({ resume: true }), pending);
    const result = await pending; assert.equal(result.installedVersion, version); assert.equal(installs, 1);
    await state.upgrade({ resume: true }); assert.equal(installs, 1);
  } finally { globalThis.fetch = original; }
});
