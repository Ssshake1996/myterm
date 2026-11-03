import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv from 'ajv';
import { fixture, OWNER } from './helpers.mjs';
import { registerTools } from '../lib/tools.js';
import { registerApiTools } from '../lib/api-tools.js';
import { ApiWorkspace } from '../lib/api-workspace.js';

async function setup(t) {
  const { state, ctx } = await fixture(t, () => '');
  const secrets = new Map([['SHARED_PASSWORD', 'old-shared-secret']]), writes = [];
  ctx.credentials.set = async (ref, value) => { writes.push(ref); secrets.set(ref, value); };
  ctx.credentials.resolve = async ref => ({ value: secrets.get(ref) });
  state.api = new ApiWorkspace({ root: join(state.base, 'api'), credentials: ctx.credentials });
  await state.api.ready; t.after(() => state.api.dispose());
  const tools = new Map(), host = { ...ctx, systemPrompt: { section() {} }, tools: { register: tool => tools.set(tool.name, tool) } };
  registerTools(host, state); registerApiTools(host, state);
  const call = (name, args) => tools.get(name).execute(args, { agent: OWNER });
  const schema = (name, args) => { const check = new Ajv({ strict: true }).compile(tools.get(name).parameters); assert.equal(check(args), true, JSON.stringify(check.errors)); };
  return { state, ctx, tools, secrets, writes, call, schema };
}

for (const transport of ['ssh', 'telnet']) test(`${transport}: Agent saves and replaces supplied passwords without persisting or returning plaintext`, async t => {
  const { state, call, schema, secrets, writes } = await setup(t), password = '  中文 P@ss "\\!  ';
  const args = { name: transport, host: 'example.test', username: 'operator', transport, password, ...(transport === 'telnet' ? { telnet: { loginMode: 'username-password' } } : {}) };
  schema('remote_environment_create', args);
  const result = await call('remote_environment_create', args), id = result.environment.id;
  const saved = state.findEnvironment(id), ref = saved.passwordRef;
  assert.equal(secrets.get(ref), password); assert.equal(Object.hasOwn(saved, 'password'), false);
  assert.equal(result.environment.passwordRef, 'configured'); assert.ok(!JSON.stringify(result).includes(password));
  const update = { environment: id, password: 'replacement-SECRET' }; schema('remote_environment_update', update);
  await call('remote_environment_update', update);
  const changed = state.findEnvironment(id); assert.notEqual(changed.passwordRef, ref);
  assert.equal(secrets.get(changed.passwordRef), update.password); assert.equal(secrets.get(ref), password);
  const before = writes.length;
  await call('remote_environment_update', { environment: id, name: transport + '-renamed', password: null });
  assert.equal(writes.length, before); assert.equal(state.findEnvironment(id).passwordRef, changed.passwordRef);
  const disk = await readFile(state.envFile('default'), 'utf8');
  for (const secret of [password, update.password]) { assert.ok(!disk.includes(secret)); assert.ok(!JSON.stringify([...state.events.values()]).includes(secret)); }
  state.environments.clear(); await state.load(); assert.equal(await state.resolvePassword(state.findEnvironment(id)), update.password);
});

test('password updates detach only the selected environment from a shared reference and retain live sessions', async t => {
  const { state, secrets, call } = await setup(t);
  for (const id of ['one', 'two']) await state.saveEnvironment({ id, name: id, host: 'example.test', username: 'u', passwordRef: 'SHARED_PASSWORD' });
  const original = state.findEnvironment('one'), live = { environment: original, session: { status: () => ({ kind: 'running' }) } };
  state.sessions.set('live', live);
  await call('remote_environment_update', { environment: 'one', password: 'one-only-new-secret' });
  assert.equal(state.sessions.get('live'), live); assert.equal(live.environment.passwordRef, 'SHARED_PASSWORD');
  assert.equal(await state.resolvePassword(state.findEnvironment('two')), 'old-shared-secret');
  assert.equal(secrets.get('SHARED_PASSWORD'), 'old-shared-secret');
  assert.equal(await state.resolvePassword(state.findEnvironment('one')), 'one-only-new-secret');
});

test('SSH password validation, duplicate names and conflicting references do not write credentials', async t => {
  const { state, call, writes } = await setup(t);
  await state.saveEnvironment({ id: 'one', name: 'taken', host: 'example.test', username: 'u', passwordRef: 'SHARED_PASSWORD' });
  for (const password of ['', 42, {}, 'x'.repeat(8193)]) await assert.rejects(call('remote_environment_update', { environment: 'one', password }), { code: 'REMOTE_PASSWORD_INVALID' });
  await assert.rejects(call('remote_environment_create', { host: 'example.test', username: 'u', name: 'taken', password: 'new' }), { code: 'REMOTE_ENV_NAME_EXISTS' });
  await assert.rejects(call('remote_environment_update', { environment: 'one', password: 'new', passwordRef: 'SHARED_PASSWORD' }), { code: 'REMOTE_PASSWORD_CONFLICT' });
  await assert.rejects(call('remote_environment_create', { host: '', username: 'u', password: 'new' }), { code: 'REMOTE_ENV_INVALID' });
  assert.equal(writes.length, 0); assert.equal(state.findEnvironment('one').passwordRef, 'SHARED_PASSWORD');
});

for (const mode of ['token', 'cookie']) test(`API ${mode}: Agent saves and updates top-level password through credentials`, async t => {
  const { state, call, schema, secrets, writes } = await setup(t), password = '  API 中文 secret  ';
  const args = { name: mode, baseUrl: 'https://example.test/api', password, auth: { mode, username: 'operator' } };
  schema('remote_api_environment_save', args);
  const result = await call('remote_api_environment_save', args), id = result.environment.id, ref = state.api.config(id).auth.passwordRef;
  assert.equal(secrets.get(ref), password); assert.ok(!JSON.stringify(result).includes(password));
  const count = writes.length;
  await call('remote_api_environment_save', { id, name: mode + '-renamed', password: null });
  assert.equal(writes.length, count); assert.equal(state.api.config(id).auth.passwordRef, ref);
  await call('remote_api_environment_save', { id, password: 'new-API-secret' });
  assert.notEqual(state.api.config(id).auth.passwordRef, ref); assert.equal(secrets.get(ref), password);
  assert.equal(secrets.get(state.api.config(id).auth.passwordRef), 'new-API-secret');
  const disk = await readFile(join(state.api.root, 'environments.json'), 'utf8');
  assert.ok(!disk.includes(password)); assert.ok(!disk.includes('new-API-secret'));
  const reload = new ApiWorkspace({ root: state.api.root, credentials: state.api.credentials }); await reload.ready;
  assert.equal(await reload.credential(reload.config(id).auth.passwordRef), 'new-API-secret'); await reload.dispose();
});

test('API rejects invalid passwords, reference conflicts and invalid configurations before writing', async t => {
  const { call, writes } = await setup(t), base = { name: 'test', baseUrl: 'https://example.test' };
  for (const password of ['', false, [], 'x'.repeat(8193)]) await assert.rejects(call('remote_api_environment_save', { ...base, password }), { code: 'API_PASSWORD_INVALID' });
  await assert.rejects(call('remote_api_environment_save', { ...base, password: 'new', auth: { passwordRef: 'SHARED_PASSWORD' } }), { code: 'API_PASSWORD_CONFLICT' });
  await assert.rejects(call('remote_api_environment_save', { ...base, baseUrl: 'file:///invalid', password: 'new' }), { code: 'API_CONFIG_INVALID' });
  assert.equal(writes.length, 0);
});

test('credential provider failures expose no secret and preserve saved environment bindings', async t => {
  const { state, ctx, call, secrets } = await setup(t), secret = 'provider-leak-SECRET';
  await state.saveEnvironment({ id: 'one', name: 'one', host: 'example.test', username: 'u', passwordRef: 'SHARED_PASSWORD' });
  const api = await state.api.save({ name: 'api', baseUrl: 'https://example.test', auth: { passwordRef: 'SHARED_PASSWORD' } });
  ctx.credentials.set = async () => { throw Error('backend error with ' + secret); };
  for (const [name, args, prefix] of [['remote_environment_update', { environment: 'one', password: secret }, 'REMOTE'], ['remote_api_environment_save', { id: api.id, password: secret }, 'API']]) {
    await assert.rejects(call(name, args), error => { assert.equal(error.code, prefix + '_PASSWORD_SAVE_FAILED'); assert.ok(!String(error.stack).includes(secret)); assert.equal(error.cause, undefined); return true; });
  }
  assert.equal(state.findEnvironment('one').passwordRef, 'SHARED_PASSWORD'); assert.equal(state.api.config(api.id).auth.passwordRef, 'SHARED_PASSWORD'); assert.equal(secrets.get('SHARED_PASSWORD'), 'old-shared-secret');
});
