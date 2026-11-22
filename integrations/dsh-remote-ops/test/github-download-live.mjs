// Explicit live-network acceptance. Downloads the current official GitHub asset,
// interrupts after 1 MiB, then verifies resumed bytes. Never installs a plugin.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fetchLatestRelease, downloadRelease } from '../lib/release.js';
import { readGitHubDownload } from '../lib/github-download.js';

if (!process.argv[2]) throw Error('Pass a dedicated evidence/cache directory');
const root = resolve(process.argv[2]); await mkdir(root, { recursive: true });
const tag = process.argv[3]; let interrupting = true;
const evidence = { kind: 'actual-github-release-download', startedAt: new Date().toISOString(), requests: [], progress: [] };
const originalFetch = fetch;
const fetchImpl = async (url, options) => {
  if (tag && url.endsWith('/releases/latest')) url = url.replace('/releases/latest', '/releases/tags/' + encodeURIComponent(tag));
  const response = await originalFetch(url, options);
  evidence.requests.push({ host: new URL(url).host, path: new URL(url).pathname, range: options.headers?.Range, ifRange: options.headers?.['If-Range'], status: response.status, contentRange: response.headers.get('content-range') });
  if (interrupting && response.status === 200 && new URL(url).host === 'release-assets.githubusercontent.com' && !new URL(url).searchParams.get('response-content-disposition')?.includes('.txt')) {
    const reader = response.body.getReader();
    // Delay reads only in the first attempt so even a small official archive
    // can be interrupted after bytes reach disk. Subsequent reads are native.
    return new Response(new ReadableStream({ async pull(controller) { await new Promise(r => setTimeout(r, 300)); try { const { done, value } = await reader.read(); if (done) controller.close(); else controller.enqueue(value); } catch (error) { controller.error(error); } }, cancel: reason => reader.cancel(reason) }), { status: response.status, headers: response.headers });
  }
  return response;
};
let logged = 0;
const onProgress = item => { if (Date.now() - logged > 10000 || ['paused', 'retrying', 'verified'].includes(item.status)) { logged = Date.now(); evidence.progress.push(item); console.log(JSON.stringify({ status: item.status, bytes: item.downloadedBytes, total: item.totalBytes, retry: item.retryCount })); } };
try {
  const release = await fetchLatestRelease({ source: 'github' }, { fetchImpl }); evidence.release = release;
  const controller = new AbortController();
  const threshold = Math.min(1024 * 1024, Math.floor(release.assetSize / 4));
  await assert.rejects(downloadRelease(release, root, { fetchImpl, signal: controller.signal, onProgress: item => { onProgress(item); if (item.downloadedBytes >= threshold && item.status === 'downloading') controller.abort(); } }), /UPDATE_CANCELLED/);
  interrupting = false;
  evidence.partial = await readGitHubDownload(root); assert.ok(evidence.partial.downloadedBytes >= threshold && evidence.partial.downloadedBytes < release.assetSize);
  const offset = evidence.partial.downloadedBytes; console.log('RESUME FROM ' + offset);
  evidence.result = await downloadRelease(release, root, { fetchImpl, onProgress });
  assert.ok(evidence.requests.some(item => item.range === `bytes=${offset}-` && item.status === 206));
  evidence.passed = true; console.log('PASS actual GitHub resume + SHA256 + package identity');
} catch (error) { evidence.error = { message: error.message, requestFailure: error.requestFailure }; process.exitCode = 1; }
finally { evidence.completedAt = new Date().toISOString(); await writeFile(join(root, 'github-download-live.json'), JSON.stringify(evidence, null, 2)); }
