import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sessionError } from './common.js';
import { requestFailure } from './http-diagnostics.js';
import { PLUGIN_NAME, RELEASE_REPOSITORY } from './version.js';

export const MAX_UPDATE_BYTES = 512 * 1024 * 1024;
const location = root => join(root, 'updates', 'github');
const sizeOf = path => stat(path).then(value => value.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
const strongEtag = value => typeof value === 'string' && /^"[^"\r\n]+"$/.test(value) ? value : null;
const fail = (code, message, retryable = false) => Object.assign(sessionError(code, message), { retryable });

async function saveJob(directory, job) {
  const temporary = join(directory, `job.${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify(job) + '\n'); await rename(temporary, join(directory, 'job.json')); }
  finally { await unlink(temporary).catch(() => {}); }
}

// One writer per DSH data directory, including two processes sharing a profile.
async function lockDownload(directory) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'download.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce: randomUUID() })); }
      catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error; }
      return async () => { await handle.close(); await unlink(path).catch(() => {}); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const raw = await readFile(path, 'utf8').catch(() => '');
      let owner; try { owner = JSON.parse(raw); } catch { /* A writer may still be creating its lock. */ }
      let dead = false;
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (cause) { dead = cause.code === 'ESRCH'; }
      }
      if (!dead || await readFile(path, 'utf8').catch(() => '') !== raw) throw fail('UPDATE_BUSY', '另一个更新下载正在使用此配置，请稍后重试');
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  throw fail('UPDATE_BUSY', '更新下载正被使用，请稍后重试');
}

export async function readGitHubDownload(root) {
  const directory = location(root);
  let job;
  try { job = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  const release = job?.release, version = release?.latestVersion;
  if (job.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(version) || release?.source !== 'github' || !/^[a-f0-9]{64}$/.test(job.checksum)
    || release.assetName !== `dsh-remote-ops-v${version}.tgz` || !['partial', 'verified', 'invalid'].includes(job.status)) return null;
  const prefix = `https://github.com/${RELEASE_REPOSITORY}/releases/download/dsh-remote-ops-v${version}/`;
  if (release.assetUrl !== prefix + release.assetName || release.checksumUrl !== prefix + `SHA256SUMS-dsh-remote-ops-v${version}.txt`) return null;
  job.etag = strongEtag(job.etag);
  job.totalBytes = Number.isSafeInteger(job.totalBytes) && job.totalBytes > 0 && job.totalBytes <= MAX_UPDATE_BYTES ? job.totalBytes : null;
  const downloadedBytes = await sizeOf(join(directory, job.status === 'verified' ? release.assetName : 'package.part'));
  if (downloadedBytes > MAX_UPDATE_BYTES) return null;
  // A cleaned-up verified cache is a fresh download, not an endless failed install retry.
  if (job.status === 'verified' && !downloadedBytes) { job.status = 'partial'; job.etag = null; }
  return { ...job, downloadedBytes };
}

export function githubDownloadProgress(job) {
  if (!job || job.status === 'invalid') return null;
  return { source: 'github', version: job.release.latestVersion, assetName: job.release.assetName,
    downloadedBytes: job.downloadedBytes, totalBytes: job.totalBytes, bytesPerSecond: 0, etaSeconds: null,
    status: job.status === 'verified' ? 'verified' : 'paused', canContinue: true,
    resumable: job.downloadedBytes > 0 && Boolean(job.etag), retryCount: 0, maxRetries: 3, retryAt: null };
}

export async function hashUpdateFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function retryAfter(headers) {
  const value = headers.get('retry-after');
  if (value) return Math.max(0, /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) || 0;
  if (headers.get('x-ratelimit-remaining') === '0') return Math.max(0, Number(headers.get('x-ratelimit-reset')) * 1000 - Date.now()) || 0;
  return 0;
}

async function errorPreview(response) {
  const reader = response.body?.getReader(), parts = []; let size = 0;
  try { while (reader && size < 8192) { const { value, done } = await reader.read(); if (done) break; const part = value.subarray(0, 8192 - size); parts.push(part); size += part.length; } }
  finally { await reader?.cancel().catch(() => {}); }
  return Buffer.concat(parts).toString('utf8');
}

// The stable Release URL is retried, never the temporary signed CDN redirect.
export async function downloadGitHubRelease(release, root, { checksum, verifyPackage, signal, fetchImpl = fetch,
  onPhase = () => {}, onProgress = () => {}, restartDownload = false, connectTimeoutMs = 30000,
  idleTimeoutMs = 60000, retryDelays = [2000, 5000, 15000] } = {}) {
  const directory = location(root), unlock = await lockDownload(directory);
  const partial = join(directory, 'package.part'), path = join(directory, release.assetName);
  let job, progress;
  const emit = patch => { progress = { ...progress, ...patch }; onProgress({ ...progress }); };
  try {
    signal?.throwIfAborted();
    const saved = await readGitHubDownload(root);
    const same = saved && saved.checksum === checksum && saved.release.assetName === release.assetName
      && saved.release.assetId === release.assetId && saved.release.assetUrl === release.assetUrl;
    job = same && !restartDownload && saved.status !== 'invalid' ? saved : {
      schemaVersion: 1, release, checksum, etag: null, totalBytes: release.assetSize ?? null, status: 'partial', downloadedBytes: 0,
    };
    if (job !== saved) {
      // Only this downloader's own current cache is retired, never user files.
      await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (saved) await unlink(join(directory, saved.release.assetName)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await saveJob(directory, job);
    }
    progress = { ...githubDownloadProgress(job), status: 'downloading', maxRetries: retryDelays.length };
    emit({ downloadedBytes: job.downloadedBytes });
    const deferredMs = Date.parse(job.retryAt ?? '') - Date.now();
    if (deferredMs > 0) {
      onPhase('download-retrying'); emit({ status: 'retrying', retryAt: job.retryAt, message: '等待 GitHub 指定的重试时间' });
      await delay(Math.min(deferredMs, 2147483647), undefined, { signal });
    }
    job.retryAt = null;
    if (job.status === 'verified') {
      onPhase('verifying');
      if (await hashUpdateFile(path) === checksum) { await verifyPackage(path); emit({ status: 'verified', canContinue: false }); return { path, sha256: checksum }; }
      job.status = 'partial'; job.etag = null; await unlink(path); await saveJob(directory, job);
    }

    const verify = async () => {
      signal?.throwIfAborted();
      onPhase('verifying'); emit({ status: 'verifying', bytesPerSecond: 0, etaSeconds: null, retryAt: null });
      if (await hashUpdateFile(partial) !== checksum) throw fail('UPDATE_CHECKSUM_MISMATCH', 'SHA256 校验失败，未执行安装。请重新下载官方安装包');
      await verifyPackage(partial);
      await rename(partial, path); job.status = 'verified'; job.downloadedBytes = await sizeOf(path); job.totalBytes = job.downloadedBytes;
      await saveJob(directory, job); emit({ status: 'verified', downloadedBytes: job.downloadedBytes, totalBytes: job.totalBytes, canContinue: false });
      return { path, sha256: checksum };
    };
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let offset = await sizeOf(partial);
      let restartMessage;
      // Complete partial files need verification, not a redundant network request.
      if (offset && offset === job.totalBytes) return await verify();
      if (offset && !job.etag) { await writeFile(partial, Buffer.alloc(0)); offset = 0; restartMessage = '下载源未提供续传标识，正在重新下载'; }
      onPhase('downloading');
      emit({ status: 'downloading', downloadedBytes: offset, totalBytes: job.totalBytes, bytesPerSecond: 0, etaSeconds: null, retryCount: attempt, retryAt: null, message: restartMessage ?? (offset ? '正在继续已保存的下载' : null) });
      const watchdog = new AbortController(), combined = signal ? AbortSignal.any([signal, watchdog.signal]) : watchdog.signal;
      let timer, timeoutKind, response, handle, status = null, responseSummary = '', url = new URL(release.assetUrl);
      const arm = (ms, kind) => { clearTimeout(timer); timer = setTimeout(() => { timeoutKind = kind; watchdog.abort(); }, ms); timer.unref?.(); };
      let failure;
      try {
        arm(connectTimeoutMs, 'connection');
        const headers = { 'User-Agent': PLUGIN_NAME, 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity',
          ...(offset ? { Range: `bytes=${offset}-`, 'If-Range': job.etag } : {}) };
        for (let redirects = 0; ; redirects++) {
          response = await fetchImpl(url.href, { headers, signal: combined, redirect: 'manual', cache: 'no-store' }); status = response.status;
          if (![301, 302, 303, 307, 308].includes(status)) break;
          await response.body?.cancel();
          if (redirects >= 5 || !response.headers.get('location')) throw fail('UPDATE_DOWNLOAD_FAILED', 'GitHub 下载重定向无效或次数过多');
          const next = new URL(response.headers.get('location'), url);
          if (next.protocol !== 'https:' || next.username || next.password || next.hash) throw fail('UPDATE_URL_INVALID', 'GitHub 下载需要安全的 HTTPS 重定向');
          url = next;
        }
        arm(idleTimeoutMs, 'idle');
        if (status === 416) {
          const total = /^bytes \*\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
          await response.body?.cancel();
          if (offset && Number(total?.[1]) === offset) { clearTimeout(timer); return await verify(); }
          await writeFile(partial, Buffer.alloc(0)); job.etag = null; job.totalBytes = release.assetSize ?? null; await saveJob(directory, job);
          throw fail('UPDATE_RANGE_INVALID', '续传范围已失效，正在重新下载', true);
        }
        if (![200, 206].includes(status)) {
          responseSummary = await errorPreview(response);
          const retryable = [408, 429, 500, 502, 503, 504].includes(status) || status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0');
          throw Object.assign(fail('UPDATE_DOWNLOAD_FAILED', `GitHub 下载返回 HTTP ${status}`, retryable), { retryAfterMs: retryAfter(response.headers) });
        }
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw fail('UPDATE_RANGE_INVALID', '下载源改变了文件编码，无法安全续传');
        let expectedEnd, total;
        const etag = strongEtag(response.headers.get('etag'));
        if (status === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
          const [start, end, length] = range ? range.slice(1).map(Number) : [];
          if (!range || ![start, end, length].every(Number.isSafeInteger) || start !== offset || end < start || end >= length
            || offset > 0 && (etag !== job.etag || job.totalBytes && length !== job.totalBytes)) {
            await response.body?.cancel(); await writeFile(partial, Buffer.alloc(0)); job.etag = null; job.totalBytes = release.assetSize ?? null; await saveJob(directory, job);
            throw fail('UPDATE_RANGE_INVALID', '续传响应与已保存文件不一致，正在重新下载', true);
          }
          total = length; expectedEnd = end + 1;
        } else {
          if (offset) emit({ message: '下载源未接受续传，已从头重新下载' });
          offset = 0;
          const length = response.headers.get('content-length'); total = length !== null ? Number(length) : release.assetSize ?? null;
          expectedEnd = total;
        }
        if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || total > MAX_UPDATE_BYTES)) throw fail('UPDATE_TOO_LARGE', '更新文件大小无效或超过限制');
        if (release.assetSize && total && total !== release.assetSize) throw fail('UPDATE_ASSET_CHANGED', 'GitHub 安装包大小已变化，请重新检查版本');
        job.etag = etag; job.totalBytes = total; job.status = 'partial'; job.retryAt = null;
        handle = await open(partial, offset ? 'a' : 'w'); await saveJob(directory, job);
        let received = offset, lastSample = Date.now(), lastBytes = offset, speed = 0;
        emit({ downloadedBytes: received, totalBytes: total, resumable: Boolean(etag) && received > 0 });
        if (!response.body) throw fail('UPDATE_DOWNLOAD_FAILED', 'GitHub 未返回安装包内容', true);
        for await (const chunk of response.body) {
          combined.throwIfAborted();
          if (received + chunk.length > MAX_UPDATE_BYTES || expectedEnd && received + chunk.length > expectedEnd) throw fail('UPDATE_RANGE_INVALID', '下载内容超出声明的文件范围');
          let written = 0;
          while (written < chunk.length) { const result = await handle.write(chunk, written, chunk.length - written); if (!result.bytesWritten) throw fail('UPDATE_WRITE_FAILED', '无法保存更新下载'); written += result.bytesWritten; }
          received += chunk.length; if (chunk.length) arm(idleTimeoutMs, 'idle');
          const now = Date.now(), elapsed = now - lastSample;
          if (elapsed >= 250) {
            const sample = (received - lastBytes) * 1000 / elapsed; speed = speed ? speed * .65 + sample * .35 : sample; lastBytes = received; lastSample = now;
            emit({ downloadedBytes: received, bytesPerSecond: speed, etaSeconds: total && speed ? Math.ceil((total - received) / speed) : null, resumable: Boolean(etag), lastByteAt: new Date(now).toISOString() });
          }
        }
        await handle.sync(); await handle.close(); handle = null;
        emit({ downloadedBytes: received, resumable: Boolean(etag) && received > 0 });
        if (expectedEnd && received !== expectedEnd || total && received !== total) throw fail('UPDATE_DOWNLOAD_INCOMPLETE', '安装包下载中断，已保存收到的数据', true);
        clearTimeout(timer); return await verify();
      } catch (error) {
        const localCodes = ['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'EROFS'];
        const certificate = /CERT|TLS|SSL|UNABLE_TO_VERIFY/.test(error.cause?.code ?? error.code ?? '');
        failure = signal?.aborted ? fail('UPDATE_CANCELLED', '插件已关闭，下载进度已保留')
          : timeoutKind ? fail('UPDATE_DOWNLOAD_TIMEOUT', timeoutKind === 'idle' ? '下载连续 60 秒没有收到数据，进度已保留' : '连接 GitHub 下载源超时', true)
          : error.code?.startsWith('UPDATE_') ? error
          : localCodes.includes(error.code) ? fail('UPDATE_WRITE_FAILED', `保存更新下载失败：${error.code}`)
          : fail('UPDATE_DOWNLOAD_FAILED', certificate ? '无法验证 GitHub 下载源证书，请检查 DSH 的证书配置' : 'GitHub 下载连接中断，进度已保留', !certificate);
        failure.requestFailure = requestFailure({ url: url.href, status, stage: 'update-package', responseSummary, cause: failure.message });
      } finally { clearTimeout(timer); await handle?.close().catch(() => {}); await response?.body?.cancel().catch(() => {}); }
      const downloadedBytes = await sizeOf(partial);
      emit({ downloadedBytes, bytesPerSecond: 0, etaSeconds: null, resumable: downloadedBytes > 0 && Boolean(job.etag) });
      const waitMs = Math.max(retryDelays[attempt] ?? 0, failure.retryAfterMs ?? 0);
      // Persist server backoffs so restarting DSH cannot cause an early retry.
      const retryAt = new Date(Date.now() + Math.min(waitMs, 2147483647)).toISOString();
      job.retryAt = retryAt; await saveJob(directory, job);
      emit({ retryAt: waitMs ? retryAt : null });
      if (!failure.retryable || attempt >= retryDelays.length) throw failure;
      emit({ status: 'retrying', retryCount: attempt + 1, retryAt, message: failure.message }); onPhase('download-retrying');
      await delay(Math.min(waitMs, 2147483647), undefined, { signal });
    }
  } catch (error) {
    if (job && ['UPDATE_CHECKSUM_MISMATCH', 'UPDATE_PACKAGE_INVALID', 'UPDATE_ASSET_CHANGED', 'UPDATE_TOO_LARGE'].includes(error.code)) {
      job.status = 'invalid'; await saveJob(directory, job); await unlink(partial).catch(() => {});
    }
    if (progress) emit({ status: job?.status === 'invalid' ? 'invalid' : 'paused', canContinue: job?.status !== 'invalid', bytesPerSecond: 0, etaSeconds: null });
    throw signal?.aborted && !error.code?.startsWith('UPDATE_') ? fail('UPDATE_CANCELLED', '插件已关闭，下载进度已保留') : error;
  } finally { await unlock(); }
}
