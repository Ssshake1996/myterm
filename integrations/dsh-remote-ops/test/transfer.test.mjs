import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostFiles, SftpFiles, TransferManager } from "../lib/transfers.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "remote-ops-transfer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"), target = join(root, "target");
  await mkdir(source); await mkdir(target);
  const manager = new TransferManager(async () => new HostFiles());
  const request = { source: { kind: "host", path: source }, target: { kind: "host", path: target }, names: ["large.bin"], conflict: "error" };
  return { source, target, manager, request };
}

test("transfers files larger than 2 MiB without altering bytes and lists progress per owner", async t => {
  const { source, target, manager, request } = await fixture(t);
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 37, 173);
  await writeFile(join(source, "large.bin"), bytes);
  const task = manager.start("one", { ...request, source: { ...request.source, entries: ["unrelated UI listing"] } });
  assert.deepEqual(task.source, request.source);
  await manager.wait("one", task.id);
  assert.deepEqual(await readFile(join(target, "large.bin")), bytes);
  assert.equal(manager.list("one")[0].status, "completed");
  assert.equal(manager.list("one")[0].bytes, bytes.length);
  assert.deepEqual(manager.list("two"), []);
  assert.throws(() => manager.cancel("two", task.id), /TRANSFER_NOT_FOUND/);
});

test("directory transfer preserves hierarchy and explicit conflict policy", async t => {
  const { source, target, manager, request } = await fixture(t);
  await mkdir(join(source, "folder", "empty"), { recursive: true });
  await writeFile(join(source, "folder", "a.txt"), "new");
  await mkdir(join(target, "folder"));
  await writeFile(join(target, "folder", "a.txt"), "old");
  const first = manager.start("one", { ...request, names: ["folder"] });
  await manager.wait("one", first.id);
  assert.equal(manager.list("one")[0].status, "failed");
  assert.match(manager.list("one")[0].error.message, /TRANSFER_EXISTS/);
  assert.equal(await readFile(join(target, "folder", "a.txt"), "utf8"), "old");
  const next = manager.start("one", { ...request, names: ["folder"], conflict: "overwrite" });
  await manager.wait("one", next.id);
  assert.equal(await readFile(join(target, "folder", "a.txt"), "utf8"), "new");
  assert.deepEqual(await readdir(join(target, "folder", "empty")), []);
});

test("cancel removes staging files and never publishes a partial destination", async t => {
  const { source, target, request } = await fixture(t);
  await writeFile(join(source, "large.bin"), Buffer.alloc(4 * 1024 * 1024));
  let task;
  const manager = new TransferManager(async () => {
    const files = new HostFiles();
    const read = files.read.bind(files);
    files.read = path => {
      const stream = read(path);
      stream.once("data", () => manager.cancel("one", task.id));
      return stream;
    };
    return files;
  });
  task = manager.start("one", request);
  await manager.wait("one", task.id);
  assert.equal(manager.list("one")[0].status, "cancelled");
  assert.deepEqual(await readdir(target), []);
});

test("transfer rejects traversal names and copying into the source tree", async t => {
  const { manager, request } = await fixture(t);
  assert.throws(() => manager.start("one", { ...request, names: ["../secret"] }), /TRANSFER_NAME_INVALID/);
  assert.throws(() => manager.start("one", { ...request, names: ["folder"], target: { ...request.source, path: join(request.source.path, "folder", "nested") } }), /TRANSFER_SAME_TREE/);
});

test("renamed transfers preserve bytes and reject replacing the source itself", async t => {
  const { source, target, manager, request } = await fixture(t);
  await writeFile(join(source, "large.bin"), "unchanged");
  const task = manager.start("one", { ...request, targetName: "renamed.bin" });
  assert.equal((await manager.wait("one", task.id)).status, "completed");
  assert.equal(await readFile(join(target, "renamed.bin"), "utf8"), "unchanged");
  const same = manager.start("one", { ...request, target: request.source, conflict: "overwrite" });
  assert.equal((await manager.wait("one", same.id)).error?.code, "TRANSFER_SAME_TREE");
  assert.equal(await readFile(join(source, "large.bin"), "utf8"), "unchanged");
});

test("SFTP cancellation closes its transport even during a metadata operation", () => {
  const controller = new AbortController();
  let destroyed = 0, ended = 0;
  const files = new SftpFiles({ destroy: () => destroyed++, end: () => ended++ }, {}, controller.signal);
  controller.abort();
  assert.equal(destroyed, 1);
  files.close();
  assert.equal(ended, 1);
});

test("queued cancellation is immediate and never opens another connection", async t => {
  const { request } = await fixture(t);
  let release, connections = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const manager = new TransferManager(async () => { connections++; await gate; return new HostFiles(); });
  manager.start("one", request); manager.start("one", request);
  const queued = manager.start("one", request);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(manager.cancel("one", queued.id).status, "cancelled");
    assert.equal((await manager.wait("one", queued.id)).error.code, "TRANSFER_CANCELLED");
    assert.equal(connections, 2);
  } finally { release(); await manager.close(); }
});

test("failed transfer retries only unfinished files and keeps per-item results", async t => {
  const { source, target, manager, request } = await fixture(t);
  for (const name of ["a", "b", "c"]) await writeFile(join(source, name), `source-${name}`);
  await writeFile(join(target, "b"), "existing-b");
  const task = manager.start("one", { ...request, names: ["a", "b", "c"] });
  const result = await manager.wait("one", task.id);
  assert.deepEqual(result.items.map(x => x.status), ["completed", "failed", "pending"]);
  await writeFile(join(target, "a"), "changed-after-copy");
  await rm(join(target, "b"));
  const retry = manager.retry("one", task.id);
  assert.throws(() => manager.retry("other", task.id), /TRANSFER_NOT_FOUND/);
  assert.equal((await manager.wait("one", retry.id)).status, "completed");
  assert.equal(await readFile(join(target, "a"), "utf8"), "changed-after-copy");
  assert.equal(await readFile(join(target, "c"), "utf8"), "source-c");
});

test("transfer preview describes both conflict files without writing anything", async t => {
  const { source, target, manager, request } = await fixture(t);
  await writeFile(join(source, "large.bin"), "source");
  await writeFile(join(target, "large.bin"), "old");
  const preview = await manager.preview("one", request);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].source.size, 6);
  assert.equal(preview.conflicts[0].target.size, 3);
  assert.equal(typeof preview.conflicts[0].source.modifiedAt, "number");
  assert.equal(await readFile(join(target, "large.bin"), "utf8"), "old");
  assert.deepEqual(manager.list("one"), []);
});
