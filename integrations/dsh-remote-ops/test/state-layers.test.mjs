import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RemoteOpsState } from "../lib/index.js";

const stateDirectory = fileURLToPath(new URL("../lib/state/", import.meta.url));
const MAX_LAYER_LINES = 300;

const methodHomes = () => {
  const homes = new Map();
  for (let proto = RemoteOpsState.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      homes.set(name, [...(homes.get(name) ?? []), proto.constructor.name]);
    }
  }
  return homes;
};

// The methods the tools, routes, terminal flows and tests call. Removing or renaming one is an API change.
const PUBLIC_METHODS = [
  "load", "readJson",
  "groupDir", "envFile", "saveGroup", "normalizeEnvironment", "groupList", "createGroup", "renameGroup", "deleteGroup", "saveEnvironment", "allEnvironments", "findEnvironment", "findEnvironmentBySessionName", "deleteEnvironment",
  "quickGroupDir", "quickFile", "saveQuickGroup", "quickGroupList", "createQuickGroup", "renameQuickGroup", "deleteQuickGroup", "saveQuickCommand", "moveQuickCommand", "deleteQuickCommand", "dispatchQuick",
  "checkForUpdate", "upgrade",
  "localSnapshot", "catalog", "connectionSnapshot", "snapshot", "controlSnapshot", "toolReceipt", "recordToolReceipt", "event",
  "activeRemoteSessions", "getSession", "reconcileHostSessions", "resolvePassword", "storePassword", "spawnBackend", "open", "openDirect", "resolveOwner", "enter", "recordDisconnect", "resize", "close",
  "ensureLocalSession", "startLocalSession",
  "terminalOutput", "readTerminal", "claimInput", "control", "send", "input", "signal",
  "execute", "cancelCommand",
  "listLocalFiles", "connectFiles", "listFiles", "sftp",
];

test("RemoteOpsState keeps its complete method inventory", () => {
  const homes = methodHomes();
  assert.deepEqual([...homes.keys()].sort(), [...PUBLIC_METHODS].sort());
});

test("every method has exactly one home, so no layer silently overrides another", () => {
  const overridden = [...methodHomes()].filter(([, owners]) => owners.length > 1);
  assert.deepEqual(overridden, []);
});

test("every layer file is composed by state/index.js and stays small", async () => {
  const index = await readFile(join(stateDirectory, "index.js"), "utf8");
  const layerFiles = (await readdir(stateDirectory)).filter((file) => file.endsWith(".js") && file !== "index.js" && file !== "base.js").sort();
  assert.ok(layerFiles.length >= 9, "the state is split into domain layers");
  for (const file of layerFiles) assert.match(index, new RegExp(`from "\\./${file.replace(".", "\\.")}"`), `${file} must be imported by state/index.js`);
  const composed = index.match(/const layers = \[([^\]]*)\]/)?.[1].split(",").map((name) => name.trim()).filter(Boolean) ?? [];
  assert.equal(composed.length, layerFiles.length, "every layer is part of the composition");
  for (const file of ["base.js", "index.js", ...layerFiles]) {
    const lines = (await readFile(join(stateDirectory, file), "utf8")).split("\n").length;
    assert.ok(lines <= MAX_LAYER_LINES, `state/${file} has ${lines} lines; split the area further instead of growing it past ${MAX_LAYER_LINES}`);
  }
});

test("instances are plain RemoteOpsState objects built by the base constructor", async () => {
  const instance = Object.create(RemoteOpsState.prototype);
  assert.ok(instance instanceof RemoteOpsState);
  assert.equal(RemoteOpsState.name, "RemoteOpsState");
  assert.equal(typeof RemoteOpsState.prototype.send, "function");
  assert.equal(Object.keys(instance).length, 0, "methods live on the prototype chain, not on instances");
});
