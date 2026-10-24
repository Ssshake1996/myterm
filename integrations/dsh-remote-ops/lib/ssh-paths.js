import { posix } from "node:path";
import { sessionError } from "./errors.js";

export function normalizeSftpPath(value, windows = false) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw sessionError("SFTP_PATH_INVALID", "Provide a non-empty remote path without NUL");
  if (!windows) return value;
  const path = value.replace(/\\/g, "/");
  if (path.startsWith("//") || /^\/?[A-Za-z]:(?!\/)/.test(path)) throw sessionError("SFTP_PATH_INVALID", "Use a drive-root path such as C:/folder, a server canonical path or a relative path");
  return /^[A-Za-z]:\//.test(path) ? "/" + path : path;
}

export function remotePathContains(from, to, windows = false) {
  const clean = path => { const value = posix.normalize(normalizeSftpPath(path, windows)); return windows ? value.toLowerCase() : value; };
  const a = clean(from).replace(/\/$/, ""), b = clean(to).replace(/\/$/, "");
  return b === a || b.startsWith(a + "/");
}

export async function mkdirSftp(call, value, windows = false) {
  const path = posix.normalize(normalizeSftpPath(value, windows));
  const drive = windows && path.match(/^\/[A-Za-z]:\//)?.[0];
  let current = drive || (path.startsWith("/") ? "/" : ".");
  const tail = path.slice(drive ? drive.length : path.startsWith("/") ? 1 : 0);
  for (const part of tail.split("/").filter(x => x && x !== ".")) {
    current = posix.join(current, part);
    let details;
    try { details = await call("stat", current); } catch (error) { if (error.code !== 2 && error.code !== "ENOENT") throw error; }
    if (details) { if ((details.mode & 0o170000) !== 0o040000) throw sessionError("SFTP_NOT_DIRECTORY", current); continue; }
    try { await call("mkdir", current); } catch (error) {
      // A concurrently created directory is fine; permission and type errors are not.
      const actual = await call("stat", current).catch(() => null);
      if ((actual?.mode & 0o170000) !== 0o040000) throw error;
    }
  }
  return path;
}
