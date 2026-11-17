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
  ctx.credentials.unset = async ref => { secrets.delete(ref); };
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

test('SSH key passphrase and account password remain independent across edits, a reload and explicit clearing', async t => {
  const { state, secrets, call, schema } = await setup(t);
  const password = 'account-password', passphrase = '  key 口令 !  ';
  const args = { name:'keys', host:'localhost', username:'u', privateKeyPath:'my-key', password, passphrase };
  schema('remote_environment_create', args);
  const created = await call('remote_environment_create', args), id = created.environment.id;
  assert.equal(created.environment.passphraseConfigured, true);
  const { passwordRef, passphraseRef } = state.findEnvironment(id);
  assert.notEqual(passwordRef, passphraseRef);
  assert.equal(secrets.get(passphraseRef), passphrase);
  const disk = await readFile(state.envFile('default'), 'utf8');
  assert.equal(JSON.parse(disk)[0].passphraseRef, passphraseRef);
  assert.ok(!disk.includes(passphrase) && !disk.includes(password));
  for (const view of [created, state.catalog(), await call('remote_environment_list')]) {
    const text = JSON.stringify(view);
    for (const secret of [password, passphrase, passphraseRef]) assert.ok(!text.includes(secret));
  }
  state.environments.clear(); await state.load();
  for (const blank of [null, '']) await call('remote_environment_update', { environment:id, name:'renamed', passphrase:blank });
  assert.equal(secrets.get(state.findEnvironment(id).passphraseRef), passphrase);
  await call('remote_environment_update', {environment:id, passphrase:'replacement'});
  assert.equal(secrets.get(state.findEnvironment(id).passphraseRef), 'replacement');
  const clear = {environment:id, clearPassphrase:true}; schema('remote_environment_update', clear);
  const cleared = await call('remote_environment_update', clear);
  assert.equal(cleared.environment.passphraseConfigured, false);
  assert.equal(secrets.has(passphraseRef), false);
  assert.equal(state.findEnvironment(id).privateKeyPath,'my-key');
  assert.equal(secrets.get(passwordRef),password);
  await call('remote_environment_update', {environment:id, passphrase});
  await call('remote_environment_update', {environment:id, privateKeyPath:''});
  assert.ok(!state.findEnvironment(id).passphraseRef && !secrets.has(passphraseRef));
  await call('remote_environment_update', {environment:id, privateKeyPath:'other',passphrase});
  await call('remote_environment_delete', {environment:id});
  assert.equal(secrets.has(passphraseRef),false);
});

test('invalid SSH key credential inputs are rejected before any vault write; vault failures omit values',async t=>{
  const { ctx,state,call,writes } = await setup(t);
  const args={host:'localhost',username:'u',privateKeyPath:'key',password:'account'};
  for(const patch of [{passphrase:7},{passphrase:'x'.repeat(8193)},{passphrase:'s',privateKeyPath:''},
    {passphrase:'s',transport:'telnet',privateKeyPath:''},{passphrase:'s',transport:'serial',password:null,serial:{path:'COM3'}}]){
    await assert.rejects(call('remote_environment_create',{...args,...patch}), {code:'SSH_KEY_PASSPHRASE_INVALID'});
  }
  assert.equal(writes.length,0);
  const { environment:{id} }=await call('remote_environment_create',args);
  await assert.rejects(call('remote_environment_update',{environment:id,passphrase:'conflict',clearPassphrase:true}),{code:'SSH_KEY_PASSPHRASE_INVALID'});
  ctx.credentials.set=async(_ref,value)=>{throw new Error(value);};
  await assert.rejects(call('remote_environment_update',{environment:id,passphrase:'sensitive-fixture-value'}),err=>
    err.code==='SSH_KEY_PASSPHRASE_SAVE_FAILED' && !err.message.includes('sensitive-fixture-value'));
  assert.equal(state.findEnvironment(id).passphraseRef,undefined);
});

test('failed persistence restores key and account credentials and leaves the saved environment intact', async t => {
  const { state, secrets, call } = await setup(t);
  const created = await call('remote_environment_create', {
    host: 'localhost', name: 'console', username: 'test', privateKeyPath: 'key', passphrase: 'old-key', password: 'old-password',
  });
  const id = created.environment.id;
  const before = state.findEnvironment(id);
  const beforeVault = new Map(secrets);
  const disk = await readFile(state.envFile('default'), 'utf8');
  const saveGroup = state.saveGroup.bind(state);
  state.saveGroup = (group, list) => {
    if (group === 'default') throw Error('fixture definition write failed');
    return saveGroup(group, list);
  };
  await assert.rejects(call('remote_environment_update', {
    environment: id, group: 'moved', passphrase: 'new-key', password: 'new-password',
  }), /fixture definition write failed/);
  await assert.rejects(call('remote_environment_delete', { environment: id }), /fixture definition write failed/);
  assert.deepEqual(state.findEnvironment(id), before);
  assert.deepEqual(secrets, beforeVault);
  assert.equal(await readFile(state.envFile('default'), 'utf8'), disk);
  await assert.rejects(readFile(state.envFile('moved')), { code: 'ENOENT' });
  state.saveGroup = saveGroup;
  await Promise.all([
    call('remote_environment_update', { environment: id, passphrase: 'new-key' }),
    call('remote_environment_update', { environment: id, clearPassphrase: true }),
    call('remote_environment_update', { environment: id, name: 'new-name' }),
  ]);
  assert.equal(state.findEnvironment(id).name, 'new-name');
  assert.equal(state.findEnvironment(id).passphraseRef, undefined);
  assert.equal(secrets.has(before.passphraseRef), false);
  assert.equal(secrets.get(before.passwordRef), 'old-password');
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
