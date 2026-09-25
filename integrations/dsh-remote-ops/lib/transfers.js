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
const info = attrs => ({ type: attrs.isSymbolicLink() ? "link" : attrs.isDirectory() ? "directory" : attrs.isFile() ? "file" : "other", size: attrs.size, modifiedAt: attrs.mtimeMs ?? (Number.isFinite(attrs.mtime) ? attrs.mtime * 1000 : null) });

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
  snapshot(job) {
    const { id, source, target, names, status, bytes, files, skipped, current, startedAt, finishedAt, error } = job;
    const counts = { completed: 0, skipped: 0, failed: 0, pending: 0, running: 0 };
    for (const item of job.items ?? []) counts[item.status]++;
    return { id, source, target, names, status, bytes, files, skipped, current, startedAt, finishedAt, error, counts,
      items: (job.items ?? []).slice(0, 200).map(({ name, type, status, error }) => ({ name, type, status, ...(error ? { error } : {}) })),
      itemsTruncated: (job.items?.length ?? 0) > 200, retryable: source.kind !== "browser" && ["failed", "cancelled"].includes(status) };
  }
  get(owner, id) { const job = this.jobs.get(id); if (!job || job.owner !== owner) throw failure("TRANSFER_NOT_FOUND", "No transfer for this session"); return job; }
  wait(owner, id) { return this.get(owner, id).done; }
  retry(owner, id) {
    const previous = this.get(owner, id);
    if (!this.snapshot(previous).retryable) throw failure("TRANSFER_RETRY_INVALID", "Only unfinished host/SSH transfers can be retried; browser files must be selected again");
    const value = this.start(owner, previous);
    const job = this.get(owner, value.id);
    if (previous.planReady) job.items = previous.items.map(item => ({ ...item, status: ["completed", "skipped"].includes(item.status) ? item.status : "pending", error: undefined }));
    job.planReady = previous.planReady;
    return this.snapshot(job);
  }
  async plan(request, source, target, signal) {
    const destination = await target.canonical(request.target.path || ".");
    const sourceRoot = source ? await source.canonical(request.source.path || ".") : "";
    if ((await target.stat(destination))?.type !== "directory") throw failure("TRANSFER_TARGET_INVALID", "Destination must be a directory");
    const items = [];
    const visit = async (from, to, name, depth) => {
      signal?.throwIfAborted();
      if (items.length >= 10000 || depth > 32) throw failure("TRANSFER_TREE_LIMIT", "Directory traversal limit reached");
      const details = source ? await source.stat(from) : { type: "file", size: request.browserFile?.size ?? null, modifiedAt: request.browserFile?.lastModified ?? null };
      if (!details || !["directory", "file"].includes(details.type)) throw failure("TRANSFER_TYPE_UNSUPPORTED", `Not a regular file or directory: ${from}`);
      items.push({ name, from, to, type: details.type, source: details, target: await target.stat(to), status: "pending" });
      if (details.type === "directory") for (const child of await source.list(from)) {
        transferName(child); await visit(source.join(from, child), target.join(to, child), `${name}/${child}`, depth + 1);
      }
    };
    for (const name of request.names) {
      const from = source ? source.join(sourceRoot, name) : name;
      const to = target.join(destination, request.targetName ?? name);
      if (source && sameEndpoint(request.source, request.target) && nested(from, to, request.source.kind === "host")) throw failure("TRANSFER_SAME_TREE", "Destination is inside the source tree");
      await visit(from, to, name, 0);
    }
    return items;
  }
  async preview(owner, request, signal) {
    if (!owner || !["host", "ssh", "browser"].includes(request.source?.kind) || !["host", "ssh"].includes(request.target?.kind)) throw failure("TRANSFER_INVALID", "Source, target and session are required");
    const names = [...new Set((request.names ?? []).map(transferName))];
    if (!names.length || names.length > 1000) throw failure("TRANSFER_INVALID", "Select between 1 and 1000 entries");
    if (request.targetName) transferName(request.targetName);
    let source, target;
    try {
      source = request.source.kind === "browser" ? null : await this.connect(request.source, signal);
      target = await this.connect(request.target, signal);
      const items = await this.plan({ ...request, names }, source, target, signal);
      const conflicts = items.filter(item => item.target && (item.type !== "directory" || item.target.type !== "directory"));
      return { total: items.length, conflictCount: conflicts.length, conflicts: conflicts.slice(0, 200).map(({ name, source, target }) => ({ name, source, target })), truncated: conflicts.length > 200 };
    } finally { source?.close(); target?.close(); }
  }
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
    const job = { id: randomUUID(), owner, source: { ...source }, target: { ...target }, names, targetName, conflict, input, items: [], planReady: false, status: "queued", bytes: 0, files: 0, skipped: 0, current: "", startedAt: new Date().toISOString(), finishedAt: null, error: null, controller: new AbortController() };
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
    let source, target, current;
    const cleanups = [];
    try {
      signal.throwIfAborted();
      source = job.source.kind === "browser" ? null : await this.connect(job.source, signal);
      target = await this.connect(job.target, signal);
      if (!job.planReady) { job.items = await this.plan(job, source, target, signal); job.planReady = true; }
      for (const item of job.items) {
        if (["completed", "skipped"].includes(item.status)) continue;
        current = item;
        signal.throwIfAborted();
        const { from, to } = item;
        item.status = "running";
        const details = source ? await source.stat(from) : { type: "file" };
        if (!details || !["directory", "file"].includes(details.type)) throw failure("TRANSFER_TYPE_UNSUPPORTED", `Not a regular file or directory: ${from}`);
        if (details.type !== item.type) throw failure("TRANSFER_SOURCE_CHANGED", `Source type changed: ${from}`);
        const exists = await target.stat(to);
        if (exists && exists.type !== details.type) throw failure("TRANSFER_TYPE_CONFLICT", `Destination type differs: ${to}`);
        if (details.type === "directory") {
          if (!exists) await target.mkdir(to);
          item.status = "completed"; continue;
        }
        if (exists && job.conflict === "skip") { job.skipped++; item.status = "skipped"; continue; }
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
        item.status = "completed";
      }
      job.status = "completed";
    } catch (error) {
      job.status = signal.aborted ? "cancelled" : "failed";
      job.error = { code: signal.aborted ? "TRANSFER_CANCELLED" : String(error.code ?? "TRANSFER_FAILED"), stage: "file-transfer", message: String(error.message ?? error), stack: error.stack ?? "" };
      if (current && !["completed", "skipped"].includes(current.status)) { current.status = signal.aborted ? "pending" : "failed"; current.error = { code: job.error.code, message: job.error.message }; }
    } finally {
      for (const path of cleanups) await target?.remove(path).catch(error => { job.error = { ...job.error, cleanupError: String(error.message ?? error) }; });
      source?.close(); target?.close(); job.input?.destroy(); job.input = undefined;
      job.finishedAt = new Date().toISOString();
      let retained = [...this.jobs.values()].reduce((sum, item) => sum + item.items.length, 0);
      for (const [id, old] of this.jobs) if (retained > 20000 && old.finishedAt && old !== job) { retained -= old.items.length; this.jobs.delete(id); }
    }
  }
}
