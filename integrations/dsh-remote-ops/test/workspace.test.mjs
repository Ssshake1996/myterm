import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerWorkspaceRoutes } from "../lib/workspace-routes.js";
import { HostFiles, TransferManager } from "../lib/transfers.js";

test("workspace activates a host owner and browser routes stream upload/download byte-for-byte", async t => {
  const root = await mkdtemp(join(tmpdir(), "remote-ops-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const routes = new Map(), calls = [];
  const state = {
    ready: Promise.resolve(),
    resolveOwner: async id => { calls.push(id); return { id }; },
    connectFiles: async () => new HostFiles(),
    transfers: new TransferManager(async () => new HostFiles()),
  };
  registerWorkspaceRoutes({ effect: fn => fn(), agents: { get: () => null }, connection: { fetch: { register: route => routes.set(route.path, route) } } }, state);
  const workspace = routes.get("/api/dsh-remote-ops/workspace");
  const activation = await workspace.fetch(new Request("http://localhost/workspace", { method: "POST", body: JSON.stringify({ action: "activate", sessionId: "cold" }) }));
  assert.deepEqual(await activation.json(), { bound: true });
  const route = routes.get("/api/dsh-remote-ops/browser-file");
  const uploadRoute = routes.get("/api/dsh-remote-ops/browser-upload");
  assert.equal(route.requestBody, "buffered");
  assert.deepEqual(route.methods, ["GET"]);
  assert.equal(uploadRoute.requestBody, "streaming");
  assert.deepEqual(uploadRoute.methods, ["POST"]);
  const url = `http://localhost/browser-file?${new URLSearchParams({ sessionId: "cold", kind: "host", path: root, name: "browser.bin" })}`;
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 1, 123);
  const uploaded = await uploadRoute.fetch(new Request(url.replace("browser-file", "browser-upload"), { method: "POST", body: bytes }));
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).bytes, bytes.length);
  assert.deepEqual(await readFile(join(root, "browser.bin")), bytes);
  const downloaded = await route.fetch(new Request(url));
  assert.equal(downloaded.headers.get("Content-Length"), String(bytes.length));
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  assert.ok(calls.every(id => id === "cold"));
});
