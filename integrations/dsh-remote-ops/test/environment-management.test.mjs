import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import { registerTools } from "../lib/tools.js";
import { registerBundledSkills } from "../lib/skills.js";
import { fixture, OWNER } from "./helpers.mjs";

async function setup(t) {
  const { state, ctx } = await fixture(t, () => "");
  const tools = new Map();
  registerTools({ ...ctx, systemPrompt: { section() {} }, tools: { register: definition => tools.set(definition.name, definition) } }, state);
  const call = (name, args = {}) => tools.get(name).execute(args, { agent: OWNER });
  const update = args => {
    assert.ok(tools.has("remote_environment_update"), "Agent must receive an explicit environment update tool");
    return call("remote_environment_update", args);
  };
  return { state, ctx, tools, call, update };
}

test("Agent renames and moves one environment without replacing its identity or omitted connection fields", async t => {
  const { state, call, update } = await setup(t);
  const original = await state.saveEnvironment({ id: "env-stable", name: "storage-old", group: "before", host: "storage.example", username: "admin", port: 2222,
    passwordRef: "STORAGE_PASSWORD", privateKeyPath: "/keys/storage", encoding: "gb18030", readyTimeoutMs: 9000,
    cliProfile: { autoQuitMore: true }, terminal: { rows: 60, cols: 200 } });
  const saved = await update({ environment: original.id, name: "storage-renamed", group: "after" });
  assert.equal(saved.saved, true);
  assert.equal(saved.environment.id, original.id);
  assert.equal(saved.environment.passwordRef, "configured");
  assert.equal(saved.connectionEffect, "new-connections-only");
  assert.deepEqual(state.findEnvironment(original.id), { ...original, name: "storage-renamed", group: "after" });
  assert.deepEqual(JSON.parse(await readFile(state.envFile("before"), "utf8")), []);
  assert.equal(JSON.parse(await readFile(state.envFile("after"), "utf8"))[0].passwordRef, "STORAGE_PASSWORD");
  state.environments.clear();
  await state.load();
  const listed = await call("remote_environment_list");
  assert.equal(listed.environments.length, 1);
  assert.equal(listed.environments[0].name, "storage-renamed");
  assert.equal(listed.environments[0].host, original.host);
  assert.equal(listed.environments[0].passwordRef, "configured");
});

test("omitted and null update fields keep values; explicit empty credential paths and empty sections clear them", async t => {
  const { state, update } = await setup(t);
  const original = await state.saveEnvironment({ id: "env-clear", name: "clearable", host: "storage.example", username: "admin", group: "dev", port: 2222,
    passwordRef: "STORAGE_PASSWORD", privateKeyPath: "/keys/storage", cliProfile: { autoQuitMore: true }, terminal: { rows: 60, cols: 200 } });
  await update({ environment: "clearable", host: "new.example", username: null, group: null, port: null, passwordRef: null, privateKeyPath: null, cliProfile: null, terminal: null });
  assert.deepEqual(state.findEnvironment(original.id), { ...original, host: "new.example" });
  await update({ environment: original.id, passwordRef: "", privateKeyPath: "", cliProfile: {}, terminal: {} });
  const cleared = state.findEnvironment(original.id);
  assert.equal(Boolean(cleared.passwordRef), false);
  assert.equal(Boolean(cleared.privateKeyPath), false);
  assert.equal(Object.hasOwn(cleared, "cliProfile"), false);
  assert.equal(Object.hasOwn(cleared, "terminal"), false);
  assert.equal(cleared.port, 2222);
  await update({ environment: original.id, passwordRef: "NEW_STORAGE_PASSWORD", encoding: "utf-8", terminal: { cols: 180 } });
  assert.equal(state.findEnvironment(original.id).passwordRef, "NEW_STORAGE_PASSWORD");
  assert.deepEqual(state.findEnvironment(original.id).terminal, { cols: 180 });
});

test("invalid environment updates reject before changing memory or persisted files", async t => {
  const { state, update } = await setup(t);
  const original = await state.saveEnvironment({ id: "env-target", name: "target", host: "storage.example", username: "admin", group: "dev", passwordRef: "KEEP_PASSWORD" });
  await state.saveEnvironment({ id: "env-other", name: "taken", host: "other.example", username: "other", group: "dev" });
  const disk = await readFile(state.envFile("dev"), "utf8");
  const invalid = [
    [{ name: "taken" }, "REMOTE_ENV_NAME_EXISTS"], [{ host: "" }, "REMOTE_ENV_INVALID"], [{ name: "  " }, "REMOTE_ENV_INVALID"],
    [{ username: 42 }, "REMOTE_ENV_INVALID"], [{ group: {} }, "REMOTE_ENV_INVALID"], [{ port: 0 }, "REMOTE_ENV_INVALID"],
    [{ port: "22" }, "REMOTE_ENV_INVALID"], [{ encoding: "guess" }, "REMOTE_ENV_INVALID"],
    [{ cliProfile: { autoConfirm: true } }, "REMOTE_ENV_INVALID"], [{ terminal: { rows: 1 } }, "REMOTE_ENV_INVALID"],
    [{ passwordRef: "configured" }, "REMOTE_ENV_INVALID"], [{ password: "do-not-store" }, "REMOTE_ENV_INVALID"],
    [{ id: "replace-identity" }, "REMOTE_ENV_INVALID"], [{ unknownField: true }, "REMOTE_ENV_INVALID"],
    [{}, "REMOTE_ENV_UPDATE_EMPTY"], [{ host: null }, "REMOTE_ENV_UPDATE_EMPTY"],
  ];
  for (const [patch, code] of invalid) {
    await assert.rejects(update({ environment: original.id, ...patch }), { code });
    assert.deepEqual(state.findEnvironment(original.id), original, JSON.stringify(patch));
    assert.equal(await readFile(state.envFile("dev"), "utf8"), disk);
  }
  await assert.rejects(update({ environment: "missing", name: "new" }), { code: "REMOTE_ENV_NOT_FOUND" });
  await assert.rejects(update({ environment: null, name: "new" }), { code: "REMOTE_ENV_INVALID" });
});

test("updating saved connection settings keeps existing SSH sessions on their original settings", async t => {
  const { state, ctx, update, call } = await setup(t);
  const original = await state.saveEnvironment({ id: "env-live", name: "live", host: "old.example", username: "admin", passwordRef: "OLD_PASSWORD" });
  const live = { sessionId: "ssh-keep", owner: OWNER, ownerId: OWNER.id, environment: original, session: { status: () => ({ kind: "running" }) } };
  state.sessions.set(live.sessionId, live);
  const killed = [];
  ctx.terminals = { kill: async (...args) => killed.push(args) };
  await update({ environment: original.id, host: "new.example", passwordRef: "NEW_PASSWORD" });
  assert.equal(state.sessions.get(live.sessionId), live);
  assert.equal(live.environment.host, "old.example");
  assert.equal(live.environment.passwordRef, "OLD_PASSWORD");
  assert.equal(state.findEnvironment(original.id).host, "new.example");
  assert.deepEqual(killed, []);
  await call("remote_environment_delete", { environment: original.id });
  assert.equal(killed.length, 1);
  assert.equal(killed[0][1], "ssh-keep");
  assert.equal(state.sessions.has("ssh-keep"), false);
  assert.equal(state.findEnvironment(original.id), undefined);
});

test("registered update Schema and bundled skill examples agree, including optional nulls and strict target selection", async t => {
  const { tools } = await setup(t);
  assert.ok(tools.has("remote_environment_update"));
  const validate = new Ajv({ strict: true }).compile(tools.get("remote_environment_update").parameters);
  assert.equal(validate({ environment: "env-1", name: "renamed" }), true);
  assert.equal(validate({ environment: "env-1", host: null, cliProfile: null, terminal: {} }), true);
  assert.equal(validate({ name: "missing-target" }), false);
  assert.equal(validate({ environment: "env-1", port: "22" }), false);
  assert.equal(validate({ environment: "env-1", password: "not-accepted" }), false);
  assert.equal(validate({ environment: "env-1", id: "replacement" }), false);
  const skill = await readFile(new URL("../skills/remote-ops-environments/SKILL.md", import.meta.url), "utf8");
  const examples = [...skill.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(match => JSON.parse(match[1]));
  assert.ok(examples.length >= 2);
  for (const example of examples) {
    const definition = tools.get(example.tool);
    assert.ok(definition, example.tool);
    assert.equal(new Ajv({ strict: true }).compile(definition.parameters)(example.arguments), true, example.tool);
  }
});

test("Agent environment create, update, group management and delete use the same persisted catalog", async t => {
  const { call } = await setup(t);
  await call("remote_environment_group_create", { group: "staging" });
  const created = await call("remote_environment_create", { name: "storage", host: "storage.example", username: "operator", group: "staging" });
  await assert.rejects(call("remote_environment_group_delete", { group: "staging" }), { code: "REMOTE_GROUP_NOT_EMPTY" });
  await call("remote_environment_group_rename", { group: "staging", name: "approved" });
  await call("remote_environment_update", { environment: created.environment.id, name: "storage-updated", port: 2222 });
  const listed = await call("remote_environment_list");
  assert.equal(listed.environments[0].id, created.environment.id);
  assert.equal(listed.environments[0].group, "approved");
  assert.equal(listed.environments[0].port, 2222);
  await call("remote_environment_delete", { environment: created.environment.id });
  await call("remote_environment_group_delete", { group: "approved" });
  const empty = await call("remote_environment_list");
  assert.equal(empty.environments.length, 0);
  assert.equal(empty.groups.length, 0);
});

test("an exact environment ID wins over another environment's matching display name", async t => {
  const { state, update } = await setup(t);
  await state.saveEnvironment({ id: "other-id", name: "chosen-id", host: "other.example", username: "other" });
  await state.saveEnvironment({ id: "chosen-id", name: "chosen", host: "chosen.example", username: "chosen" });
  await update({ environment: "chosen-id", port: 2222 });
  assert.equal(state.findEnvironment("chosen-id").host, "chosen.example");
  assert.equal(state.findEnvironment("chosen-id").port, 2222);
  assert.equal(state.findEnvironment("other-id").port, undefined);
});

test("a host without nested environment parameters retains the explicit update tool and reports its fallback", async t => {
  const { state, ctx } = await setup(t);
  const registered = new Map();
  registerTools({ ...ctx, systemPrompt: { section() {} }, tools: { register(definition) {
    if (definition.name === "remote_environment_update" && definition.parameters.properties.cliProfile) throw new Error("nested parameters unsupported");
    registered.set(definition.name, definition);
  } } }, state);
  const tool = registered.get("remote_environment_update");
  assert.ok(tool);
  assert.equal(tool.parameters.properties.cliProfile, undefined);
  assert.equal(tool.parameters.properties.terminal, undefined);
  assert.equal(state.toolWarnings.at(-1).tool, "remote_environment_update");
  await state.saveEnvironment({ id: "fallback", name: "fallback", host: "storage.example", username: "operator" });
  assert.equal((await tool.execute({ environment: "fallback", name: "renamed" }, { agent: OWNER })).environment.name, "renamed");
});

test("the installed plugin skill provider discovers and resolves both environment and browser guides independently", async () => {
  let provider;
  registerBundledSkills({ inject: (_services, ready) => ready({ skills: { registerProvider: factory => { provider = factory(); } } }) });
  const entries = await provider.list();
  assert.deepEqual(entries.map(entry => entry.name).sort(), ["remote-ops-browser", "remote-ops-environments"]);
  for (const entry of entries) {
    const loaded = await provider.get(entry, {});
    assert.equal(loaded.name, entry.name);
    assert.ok(loaded.content.length > 100);
    assert.equal(entry.invocation.modelInvocable, true);
    assert.equal(entry.invocation.userInvocable, true);
  }
  assert.equal(await provider.get({ name: "missing-skill", locator: "missing-skill" }, {}), undefined);
});
