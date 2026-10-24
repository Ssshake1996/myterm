import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { registerTools } from "../lib/tools.js";
import { registerBrowserTools } from "../lib/browser-tools.js";

const tools = new Map();
const ctx = { tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section() {} } };
registerTools(ctx, { toolWarnings: [] });
registerBrowserTools(ctx, { browser: {} });
const ajv = new Ajv({ strict: true, allErrors: true });

test("all plugin tools expose standard object JSON Schemas, including nested required arrays", () => {
  assert.ok(tools.size > 30);
  for (const [name, tool] of tools) {
    assert.equal(tool.parameters.type, "object", name);
    assert.equal(typeof tool.parameters.properties, "object", name);
    assert.doesNotThrow(() => ajv.compile(tool.parameters), name);
  }
});

test("browser schemas validate complete URL, login, observation and control arguments", () => {
  const examples = {
    remote_browser_list: {},
    remote_browser_runtime: { action: "install" },
    remote_browser_open: { url: "https://example.test/", display: "embedded", browser: "chrome" },
    remote_browser_login: { requestId: "login-1" },
    remote_browser_read: { target: { kind: "xpath", value: "//*[@id='result']", frame: null } },
    remote_browser_control: { action: "focus" },
  };
  for (const [name, args] of Object.entries(examples)) {
    const validate = ajv.compile(tools.get(name).parameters);
    assert.equal(validate(args), true, name + JSON.stringify(validate.errors));
  }
  assert.equal(ajv.compile(tools.get("remote_browser_open").parameters)({ url: "https://example.test/", browser: "guess" }), false);
  assert.equal(ajv.compile(tools.get("remote_browser_control").parameters)({ action: "pause" }), false);
});

test("browser schemas expose the supported JSON and selector compatibility forms", () => {
  const validate = ajv.compile(tools.get("remote_browser_run").parameters);
  const step = { action: "click", target: "xpath=//button" };
  for (const steps of [[step], step, { steps: [step] }, JSON.stringify([step])]) assert.equal(validate({ requestId: "compat", steps }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ requestId: "bad", steps: { steps: [step], flowId: "ignored" } }), false);
  const read = ajv.compile(tools.get("remote_browser_read").parameters);
  assert.equal(read({ target: "#entry" }), true);
  // DSH's Schema subset cannot express string lengths; runtime preflight enforces them.
  assert.equal(read({ target: "" }), true);
});

test("browser Schemas stay within the real DSH host's supported JSON Schema subset", () => {
  const allowed=new Set(['type','oneOf','properties','required','additionalProperties','items','enum','const','description']);
  const inspect=schema=>{
    assert.ok(Object.keys(schema).every(key=>allowed.has(key)),JSON.stringify(Object.keys(schema)));
    for(const value of Object.values(schema.properties??{}))inspect(value);
    for(const value of schema.oneOf??[])inspect(value);
    if(schema.items)inspect(schema.items);
    if(schema.additionalProperties&&typeof schema.additionalProperties==='object')inspect(schema.additionalProperties);
  };
  for(const [name,tool] of tools)if(name.startsWith('remote_browser_') || ['remote_environment_create','remote_environment_update','remote_environment_test','remote_command_execute'].includes(name))inspect(tool.parameters);
});

test("browser run schema expresses supported actions, locators and conditional required fields", () => {
  const validate = ajv.compile(tools.get("remote_browser_run").parameters);
  const target = { kind: "css", value: "#entry" };
  const valid = [
    { action: "goto", url: "https://example.test/" },
    { action: "fill", target, value: "" },
    { action: "fill", target, value: null, secretRef: "SITE_PASSWORD" },
    { action: "press", target, value: "Enter" },
    { action: "read", target },
    { action: "click", target: { ...target, name: null, frame: "" }, value: null, secretRef: null, timeoutMs: null, expect: null, expectPopup: null, state: null },
  ];
  for (const step of valid) assert.equal(validate({ requestId: "schema-1", flowId: null, steps: [step] }), true, JSON.stringify(validate.errors));
  const invalid = [
    { action: "goto" }, { action: "read" }, { action: "type", target, value: "x" },
    { action: "click", target: { kind: "invented", value: "#entry" } },
    { action: "click", target: { kind: "css" } },
    { action: "fill", target, value: null, secretRef: null },
    { action: "fill", target, value: "x", secretRef: "SITE_PASSWORD" },
    { action: "press", target },
    { action: "click", target, expect: { text: "OK" } },
  ];
  for (const step of invalid) assert.equal(validate({ requestId: "schema-1", steps: [step] }), false, JSON.stringify(step));
  assert.equal(validate({ steps: [{ action: "read", target }] }), false, "requestId is required");
  const skill = readFileSync(new URL("../skills/remote-ops-browser/SKILL.md", import.meta.url), "utf8");
  const example = JSON.parse(skill.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1]);
  assert.equal(validate(example), true, "bundled skill must match the exported tool Schema");
});

test("terminal and SFTP metadata preserve required arguments and existing nested contracts", () => {
  const send = ajv.compile(tools.get("remote_terminal_send").parameters);
  assert.equal(send({ session: "s", text: "echo  a  b", autoSigint: false }), true);
  assert.equal(send({ session: "s" }), false);
  const script = tools.get("remote_terminal_script").parameters;
  assert.ok(script.required.includes("steps"));
  assert.deepEqual(script.properties.steps.items.required, ["text"]);
  const answer = script.properties.steps.items.properties.answers.items;
  assert.deepEqual(answer.required, ["pattern", "text"]);
  assert.equal(tools.get("remote_sftp_upload").parameters.properties.overwrite.type, "boolean");
});

test("Windows tool metadata and bundled execution example pass the same object Schema as DSH", () => {
  const create = ajv.compile(tools.get("remote_environment_create").parameters);
  assert.equal(create({ host: "windows.example", username: "HOST\\operator", platform: "windows", shell: "windows-powershell", readyTimeoutMs: 15000 }), true);
  assert.equal(create({ host: "windows.example", username: "operator", transport: "winrm" }), false);
  assert.equal(ajv.compile(tools.get("remote_environment_test").parameters)({ environment: "id" }), true);
  const execute = ajv.compile(tools.get("remote_command_execute").parameters);
  const skill = readFileSync(new URL("../skills/remote-ops-windows/SKILL.md", import.meta.url), "utf8");
  const example = JSON.parse(skill.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1]);
  assert.equal(execute(example), true, JSON.stringify(execute.errors));
  assert.equal(execute({ ...example, parameters: JSON.stringify(example.parameters) }), false);
});
