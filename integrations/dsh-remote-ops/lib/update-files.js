import { dirname, relative, isAbsolute, posix, resolve } from "node:path";
import { HostFiles } from "./transfers.js";
import { finished } from "node:stream/promises";
import { sessionError } from "./common.js";

export function updateFilePath(value, manifest, source) {
  let path;
  try { path = decodeURIComponent(value); } catch { throw sessionError("UPDATE_PATH_INVALID", "版本清单中的文件路径编码无效"); }
  if (typeof value !== "string" || !path || /[:\\\0]/.test(path) || path.startsWith("/") || path.split("/").some(part => part === ".." || part === "." || !part)) throw sessionError("UPDATE_PATH_INVALID", "版本清单必须使用目录内的相对文件路径");
  return source === "sftp" ? posix.join(posix.dirname(manifest), path) : resolve(dirname(manifest), ...path.split("/"));
}

export async function readUpdateFile(settings, path, { connectFiles, signal, limit = 256 * 1024, timeoutMs = 12000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  let files, stream, streamDone, rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => {
    const error = sessionError(timeout.aborted ? "UPDATE_CHECK_TIMEOUT" : "UPDATE_CANCELLED", timeout.aborted ? "读取更新文件超时" : "更新文件读取已取消");
    stream?.destroy(error); files?.close(); rejectAbort(error);
  };
  combined.addEventListener("abort", abort, { once: true });
  const check = () => { if (combined.aborted) { stream?.destroy(); files?.close(); throw sessionError("UPDATE_CANCELLED", "更新文件读取已取消"); } };
  try {
    if (combined.aborted) abort();
    return await Promise.race([aborted, (async () => {
      check();
      if (settings.source === "sftp" && !connectFiles) throw sessionError("UPDATE_SOURCE_UNAVAILABLE", "SFTP 更新需要已保存的 SSH 环境");
      files = settings.source === "sftp" ? await connectFiles({ kind: "ssh", environment: settings.environment }, combined) : new HostFiles();
      check();
      const remote = settings.source === "sftp";
      const root = await files.canonical(remote ? posix.dirname(settings.path) : dirname(settings.path)); check();
      const actual = await files.canonical(path); check();
      const delta = remote ? posix.relative(root, actual) : relative(root, actual);
      if (!delta || delta === ".." || delta.startsWith(remote ? "../" : "..\\") || delta.startsWith("../") || (remote ? posix.isAbsolute(delta) : isAbsolute(delta))) throw sessionError("UPDATE_PATH_INVALID", "更新文件不能越过配置目录，符号链接也必须位于目录内");
      const info = await files.stat(actual); check();
      if (info?.type !== "file") throw sessionError("UPDATE_FILE_INVALID", "更新源必须提供普通文件");
      if (info.size > limit) throw sessionError("UPDATE_TOO_LARGE", "更新文件超过大小限制");
      stream = files.read(actual); streamDone = finished(stream); streamDone.catch(() => {}); check();
      const chunks = []; let size = 0;
      for await (const chunk of stream) {
        check(); size += chunk.byteLength;
        if (size > limit) throw sessionError("UPDATE_TOO_LARGE", "更新文件超过大小限制");
        chunks.push(Buffer.from(chunk));
      }
      await streamDone;
      return Buffer.concat(chunks);
    })()]);
  } catch (error) {
    if (error.code?.startsWith("UPDATE_")) throw error;
    throw sessionError("UPDATE_READ_FAILED", `读取更新文件失败，请检查${settings.source === "sftp" ? " SSH 环境、凭据、SFTP 路径和权限" : " DSH 主机上的路径和访问权限"}`);
  } finally { combined.removeEventListener("abort", abort); stream?.destroy(); await streamDone?.catch(() => {}); files?.close(); }
}
