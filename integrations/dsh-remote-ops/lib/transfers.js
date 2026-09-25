import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readdir, mkdir, rename, unlink, link, realpath } from "node:fs/promises";
import { resolve, join, posix, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const failure = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const missing = error => error.code === "ENOENT" || error.code === 2;
export function transferName(name) {
  if (typeof name !== "string" || !name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw failure("TRANSFER_NAME_INVALID", "Select a direct child file or directory");
  return name;
}
const info = attrs => ({ type: attrs.isSymbolicLink() ? "link" : attrs.isDirectory() ? "directory" : attrs.isFile() ? "file" : "other", size: attrs.size });

export class HostFiles {
  join(...parts) { return join(...parts); }
  async canonical(path) { return realpath(resolve(path)); }
  async stat(path) { try { return info(await lstat(path)); } catch (error) { if (missing(error)) return null; throw error; } }
  async list(path) { return readdir(path); }
  async mkdir(path) { await mkdir(path); }
  read(path) { return createReadStream(path, { highWaterMark: 64 * 1024 }); }
  write(path) { return createWriteStream(path, { flags: "wx", highWaterMark: 64 * 1024 }); }
  async publish(from, to, overwrite) { if (overwrite) await rename(from, to); else { await link(from, to); await unlink(from); } }
  async remove(path) { await unlink(path).catch(error => { if (!missing(error)) throw error; }); }
  close() {}
}

export class SftpFiles {
  constructor(client, sftp, signal) {
    this.client = client; this.sftp = sftp; this.signal = signal;
    this.abort = () => client.destroy();
    if (signal?.aborted) this.abort(); else signal?.addEventListener("abort", this.abort, { once: true });
  }
  call(method, ...args) { return new Promise((resolve, reject) => this.sftp[method](...args, (error, value) => error ? reject(error) : resolve(value))); }
  join(...parts) { return posix.join(...parts); }
  canonical(path) { return this.call("realpath", path); }
  async stat(path) { try { return info(await this.call("lstat", path)); } catch (error) { if (missing(error)) return null; throw error; } }
  async list(path) { return (await this.call("readdir", path)).map(entry => entry.filename); }
  mkdir(path) { return this.call("mkdir", path); }
  read(path) { return this.sftp.createReadStream(path, { highWaterMark: 64 * 1024 }); }
  write(path) { return this.sftp.createWriteStream(path, { flags: "wx", highWaterMark: 64 * 1024 }); }
  async publish(from, to, overwrite) {
    if (overwrite && await this.stat(to)) {
      // Never delete the existing target to emulate a rename that the server cannot do atomically.
      await this.call("ext_openssh_rename", from, to);
    } else await this.call("rename", from, to);
  }
  async remove(path) { await this.call("unlink", path).catch(error => { if (!missing(error)) throw error; }); }
  close() { this.signal?.removeEventListener("abort", this.abort); this.client.end(); }
}

function sameEndpoint(a, b) { return a.kind === b.kind && (a.kind === "host" || a.environment === b.environment); }
function nested(a, b, host) {
  const delta = host ? relative(resolve(a), resolve(b)) : posix.relative(posix.resolve(a), posix.resolve(b));
  return delta === "" || (!delta.startsWith("..") && !(host ? isAbsolute(delta) : posix.isAbsolute(delta)));
}

export class TransferManager {
  constructor(connect) { this.connect = connect; this.jobs = new Map(); this.running = 0; }
  list(owner) { return [...this.jobs.values()].filter(job => job.owner === owner).map(job => this.snapshot(job)); }
  snapshot(job) { const { id, source, target, names, status, bytes, files, skipped, current, startedAt, finishedAt, error } = job; return { id, source, target, names, status, bytes, files, skipped, current, startedAt, finishedAt, error }; }
  get(owner, id) { const job = this.jobs.get(id); if (!job || job.owner !== owner) throw failure("TRANSFER_NOT_FOUND", "No transfer for this session"); return job; }
  wait(owner, id) { return this.get(owner, id).done; }
  cancel(owner, id) {
    const job = this.get(owner, id);
    if (["queued", "running"].includes(job.status)) job.controller.abort();
    if (job.status === "queued") {
      job.status = "cancelled"; job.finishedAt = new Date().toISOString();
      job.error = { code: "TRANSFER_CANCELLED", stage: "file-transfer", message: "Cancelled before transfer started", stack: "" };
      job.input?.destroy(); job.input = undefined; job.resolve(this.snapshot(job));
    }
    return this.snapshot(job);
  }
  async close() { for (const job of this.jobs.values()) this.cancel(job.owner, job.id); await Promise.all([...this.jobs.values()].map(job => job.done)); }
  start(owner, request, input) {
    const endpoint = value => value && ({ kind: value.kind, path: value.path || ".", ...(value.kind === "ssh" ? { environment: value.environment } : {}) });
    const source = endpoint(request.source), target = endpoint(request.target), conflict = request.conflict ?? "error";
    if (!owner || !source || !target || !["host", "ssh", "browser"].includes(source.kind) || !["host", "ssh"].includes(target.kind)) throw failure("TRANSFER_INVALID", "Source, target and session are required");
    if (!["error", "skip", "overwrite"].includes(conflict)) throw failure("TRANSFER_INVALID", "Unknown conflict policy");
    const names = [...new Set((request.names ?? []).map(transferName))];
    const targetName = request.targetName ? transferName(request.targetName) : undefined;
    if (!names.length || names.length > 1000) throw failure("TRANSFER_INVALID", "Select between 1 and 1000 entries");
    if (source.kind === "browser" && (!input || names.length !== 1)) throw failure("TRANSFER_INVALID", "Browser upload requires one input stream");
    if (sameEndpoint(source, target) && names.some(name => nested(source.kind === "host" ? join(source.path, name) : posix.join(source.path, name), target.path, source.kind === "host"))) throw failure("TRANSFER_SAME_TREE", "Destination is inside the source tree");
    if ([...this.jobs.values()].filter(job => ["running", "queued"].includes(job.status)).length >= 20) throw failure("TRANSFER_QUEUE_FULL", "Wait for active transfers");
    for (const [id, job] of this.jobs) if (this.jobs.size >= 50 && job.finishedAt) this.jobs.delete(id);
    if (targetName && names.length !== 1) throw failure("TRANSFER_INVALID", "A renamed transfer requires one source");
    const job = { id: randomUUID(), owner, source: { ...source }, target: { ...target }, names, targetName, conflict, input, status: "queued", bytes: 0, files: 0, skipped: 0, current: "", startedAt: new Date().toISOString(), finishedAt: null, error: null, controller: new AbortController() };
    job.done = new Promise(resolve => { job.resolve = resolve; });
    this.jobs.set(job.id, job);
    queueMicrotask(() => this.pump());
    return this.snapshot(job);
  }
  pump() {
    for (const job of this.jobs.values()) {
      if (this.running >= 2) break;
      if (job.status !== "queued") continue;
      this.running++; job.status = "running";
      void this.run(job).finally(() => { this.running--; job.resolve(this.snapshot(job)); this.pump(); });
    }
  }
  async run(job) {
    const signal = job.controller.signal;
    let source, target;
    const cleanups = [];
    try {
      signal.throwIfAborted();
      source = job.source.kind === "browser" ? null : await this.connect(job.source, signal);
      target = await this.connect(job.target, signal);
      const destination = await target.canonical(job.target.path || ".");
      const sourceRoot = source ? await source.canonical(job.source.path || ".") : "";
      if ((await target.stat(destination))?.type !== "directory") throw failure("TRANSFER_TARGET_INVALID", "Destination must be a directory");
      let entries = 0;
      const copy = async (from, to, depth = 0) => {
        signal.throwIfAborted();
        if (++entries > 10000 || depth > 32) throw failure("TRANSFER_TREE_LIMIT", "Directory traversal limit reached");
        const details = source ? await source.stat(from) : { type: "file" };
        if (!details || !["directory", "file"].includes(details.type)) throw failure("TRANSFER_TYPE_UNSUPPORTED", `Not a regular file or directory: ${from}`);
        const exists = await target.stat(to);
        if (exists && exists.type !== details.type) throw failure("TRANSFER_TYPE_CONFLICT", `Destination type differs: ${to}`);
        if (details.type === "directory") {
          if (!exists) await target.mkdir(to);
          for (const name of await source.list(from)) { transferName(name); await copy(source.join(from, name), target.join(to, name), depth + 1); }
          return;
        }
        if (exists && job.conflict === "skip") { job.skipped++; return; }
        if (exists && job.conflict === "error") throw failure("TRANSFER_EXISTS", `Destination already exists: ${to}`);
        const temp = `${to}.remote-ops-${job.id}.part`;
        cleanups.push(temp);
        job.current = from;
        const meter = new Transform({ transform: (chunk, _encoding, callback) => { job.bytes += chunk.length; callback(null, chunk); } });
        await pipeline(source ? source.read(from) : job.input, meter, target.write(temp), { signal });
        signal.throwIfAborted();
        await target.publish(temp, to, job.conflict === "overwrite");
        cleanups.splice(cleanups.indexOf(temp), 1);
        job.files++;
      };
      for (const name of job.names) {
        const from = source ? source.join(sourceRoot, name) : name;
        const to = target.join(destination, job.targetName ?? name);
        if (source && sameEndpoint(job.source, job.target) && nested(from, to, job.source.kind === "host")) throw failure("TRANSFER_SAME_TREE", "Destination is inside the source tree");
        await copy(from, to);
      }
      job.status = "completed";
    } catch (error) {
      job.status = signal.aborted ? "cancelled" : "failed";
      job.error = { code: signal.aborted ? "TRANSFER_CANCELLED" : String(error.code ?? "TRANSFER_FAILED"), stage: "file-transfer", message: String(error.message ?? error), stack: error.stack ?? "" };
    } finally {
      for (const path of cleanups) await target?.remove(path).catch(error => { job.error = { ...job.error, cleanupError: String(error.message ?? error) }; });
      source?.close(); target?.close(); job.input?.destroy(); job.input = undefined;
      job.finishedAt = new Date().toISOString();
    }
  }
}
