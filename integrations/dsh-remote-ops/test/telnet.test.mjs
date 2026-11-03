import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import iconv from 'iconv-lite';
import { validateEnvironment } from '../lib/common.js';
import { registerTools } from '../lib/tools.js';
import { fixture, OWNER } from './helpers.mjs';

const until = async predicate => { for (let n = 0; n < 150; n++) { if (predicate()) return; await delay(10); } throw Error('Telnet fixture did not settle'); };
async function device(t, connected) {
  const sockets = new Set(), received = [];
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.on('data', data => received.push(data)); connected(socket);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { environment: { id: 'telnet-test', name: 'Telnet test', transport: 'telnet', host: '127.0.0.1', port: server.address().port, telnet: { loginMode: 'none' } }, received, sockets };
}
async function connect(t, environment, options) {
  const { connectTelnet } = await import('../lib/telnet-connection.js');
  const session = await connectTelnet(environment, options);
  t.after(() => session.close());
  return session;
}

test('Telnet environments validate auth modes without weakening SSH requirements', () => {
  const base = { id: 't', name: 't', host: 'device', transport: 'telnet' };
  for (const loginMode of ['manual', 'none', 'password']) assert.equal(validateEnvironment({ ...base, telnet: { loginMode } }).ok, true);
  assert.equal(validateEnvironment({ ...base, telnet: { loginMode: 'username-password' } }).ok, false);
  assert.equal(validateEnvironment({ ...base, username: 'operator', telnet: { loginMode: 'username-password' } }).ok, true);
  assert.equal(validateEnvironment({ ...base, transport: 'ssh' }).ok, false);
  for (const patch of [{ transport: 'ftp' }, { telnet: { loginMode: 'guess' } }, { telnet: { shellPrompt: '[' } }, { telnet: { unknown: true } }, { shell: 'pwsh' }, { privateKeyPath: 'key' }, { password: 'must-not-persist' }]) assert.equal(validateEnvironment({ ...base, ...patch }).ok, false, JSON.stringify(patch));
});

test('Telnet schema, environment persistence and update support password-only targets', async t => {
  const { state, ctx } = await fixture(t, () => '');
  const tools = new Map();
  registerTools({ ...ctx, systemPrompt: { section() {} }, tools: { register: tool => tools.set(tool.name, tool) } }, state);
  const args = { name: 'switch', host: 'device.example', transport: 'telnet', passwordRef: 'DEVICE_PASSWORD', telnet: { loginMode: 'password' } };
  const validate = new Ajv({ strict: true }).compile(tools.get('remote_environment_create').parameters);
  assert.equal(validate(args), true, JSON.stringify(validate.errors));
  const saved = await tools.get('remote_environment_create').execute(args, { agent: OWNER });
  assert.equal(saved.environment.transport, 'telnet');
  await state.updateEnvironment(saved.environment.id, { username: '', telnet: { loginMode: 'manual' } });
  state.environments.clear(); await state.load();
  assert.equal(state.findEnvironment(saved.environment.id).telnet.loginMode, 'manual');
});

test('fragmented IAC negotiation is removed from output; duplicate offers do not loop; NAWS and terminal type respond', async t => {
  const dev = await device(t, socket => {
    const bytes = [255,251,1,255,251,1,255,253,31,255,253,24,255,250,24,1,255,240,255,251,99];
    (async () => { for (const byte of bytes) { if (socket.destroyed) return; socket.write(Buffer.from([byte])); await delay(1); } socket.write('\r\ndevice> '); })();
  });
  const session = await connect(t, dev.environment);
  await session.loginReady;
  assert.equal(session.login.state, 'ready');
  assert.equal(session.output.includes('\ufffd'), false);
  assert.match(session.output, /device> /);
  // Client login output and server receipt are independent socket callbacks.
  // Wait for the last negotiated response before inspecting what the server received.
  await until(() => Buffer.concat(dev.received).includes(Buffer.from([255,254,99])));
  const raw = Buffer.concat(dev.received);
  assert.equal(raw.toString('hex').split('fffd01').length - 1, 1);
  assert.ok(raw.includes(Buffer.from([255,251,31])));
  assert.ok(raw.includes(Buffer.from([255,250,31,0,160,0,40,255,240])));
  assert.ok(raw.includes(Buffer.from('xterm-256color')));
  assert.ok(raw.includes(Buffer.from([255,254,99])));
  session.resize(50,255); await until(() => Buffer.concat(dev.received).includes(Buffer.from([255,250,31,0,255,255,0,50,255,240])));
});

test('CR NUL padding is removed only in NVT mode and literal IAC resets CR state', async t => {
  const dev = await device(t, socket => socket.write('device> '));
  const session = await connect(t, dev.environment); await session.loginReady;
  const socket = [...dev.sockets][0];
  socket.write(Buffer.from([13, 0, 65]));
  await until(() => session.output.endsWith('A'));
  assert.ok(session.output.endsWith('\rA'));
  socket.write(Buffer.from([13, 255, 255, 0, 66]));
  await until(() => session.output.endsWith('B'));
  assert.ok(session.output.endsWith('\r\ufffd\0B'));
  socket.write(Buffer.from([255, 251, 0, 13, 0, 67]));
  await until(() => session.output.endsWith('C'));
  assert.ok(session.output.endsWith('\r\0C'));
  socket.write(Buffer.from([255, 252, 0, 13, 0, 68]));
  await until(() => session.output.endsWith('D'));
  assert.ok(session.output.endsWith('\rD'));
});

test('automatic login handles fragmented prompts and masks password echoed across packets', async t => {
  const secret = 'test-S3cret-739'; let input = '', phase = 0;
  const dev = await device(t, socket => {
    socket.write('User'); setTimeout(() => socket.write('name: '), 10);
    socket.on('data', data => { input += data.toString(); if (!input.endsWith('\r\n')) return;
      if (phase++ === 0) { assert.equal(input, 'operator\r\n'); input = ''; socket.write('\r\nPass'); setTimeout(() => socket.write('word: '), 10); }
      else if (phase === 2) { assert.equal(input, secret+'\r\n'); input = ''; socket.write(secret.slice(0,6)); setTimeout(() => socket.write(secret.slice(6)+'\r\ndevice> '), 10); }
      else socket.write('command result\r\ndevice> ');
    });
  });
  const session = await connect(t, { ...dev.environment, username: 'operator', telnet: { loginMode: 'username-password' } }, { password: secret });
  await session.loginReady;
  assert.equal(session.login.state, 'ready');
  assert.ok(!session.output.includes(secret)); assert.ok(!session.output.includes(secret.slice(0,6)));
  const op = session.startSend({ text: 'show version', submit: true, quietMs: 30, timeoutMs: 500 });
  const result = await op.done;
  assert.equal(result.completion, 'unknown'); assert.match(session.output, /command result/);
});

test('password-only failure does not resend credentials or leak them', async t => {
  let attempts = 0;
  const dev = await device(t, socket => { socket.write('Password: '); socket.on('data', () => { attempts++; socket.write('\r\nLogin incorrect\r\nPassword: '); }); });
  const session = await connect(t, { ...dev.environment, telnet: { loginMode: 'password' } }, { password: 'bad-secret' });
  await assert.rejects(session.loginReady, { code: 'TELNET_AUTH_FAILED' });
  assert.equal(attempts, 1); assert.equal(session.login.state, 'failed');
  assert.throws(() => session.startSend({ text: 'danger', submit: true }), { code: 'TELNET_LOGIN_REQUIRED' });
  assert.ok(!session.output.includes('bad-secret'));
});

test('manual login is visible; input remains shared and CR is encoded once', async t => {
  const dev = await device(t, socket => { socket.write('login: '); socket.on('data', () => socket.write('\r\ndevice> ')); });
  const session = await connect(t, { ...dev.environment, telnet: { loginMode: 'manual' } });
  await until(() => session.output.includes('login:'));
  assert.equal(session.login.state, 'manual');
  session.writeInput('operator\r'); await until(() => session.login.state === 'ready');
  assert.equal(Buffer.concat(dev.received).toString(), 'operator\r\n');
  session.writeInput('show\r\n'); await until(() => Buffer.concat(dev.received).toString().endsWith('show\r\n'));
  assert.ok(!Buffer.concat(dev.received).toString().includes('\r\r\n'));
});

test('TCP connection alone never confirms login; timeout is finite and close settles login', async t => {
  const dev = await device(t, () => {});
  const session = await connect(t, { ...dev.environment, readyTimeoutMs: 1000 });
  assert.notEqual(session.login.state, 'ready');
  await assert.rejects(session.loginReady, { code: 'TELNET_LOGIN_TIMEOUT' });
  await session.close(); assert.equal(session.status().kind, 'exited');
});

test('GB18030 split output, literal IAC bytes, Ctrl+C and remote closure preserve terminal semantics', async t => {
  const dev=await device(t,socket=>socket.write('device> '));
  const session=await connect(t,{...dev.environment,encoding:'gb18030'}); await session.loginReady;
  const socket=[...dev.sockets][0], word=iconv.encode('中文回显','gb18030');
  for(const byte of word) socket.write(Buffer.from([byte]));
  socket.write(Buffer.from([255,255])); socket.write('\r\ndevice> ');
  await until(()=>session.output.includes('中文回显'));
  session.writeInput('中文\r'); await until(()=>Buffer.concat(dev.received).includes(iconv.encode('中文\r\n','gb18030')));
  session.signal('SIGINT'); await until(()=>Buffer.concat(dev.received).includes(Buffer.from([3])));
  assert.throws(()=>session.signal('SIGTERM'),{code:'TELNET_SIGNAL_UNSUPPORTED'});
  socket.destroy(); await until(()=>session.status().kind==='exited');
  assert.throws(()=>session.writeInput('again'),{code:'REMOTE_SESSION_EXITED'});
});

test('automatic login credentials cannot contain terminal control characters', async () => {
  const {connectTelnet}=await import('../lib/telnet-connection.js');
  const env={id:'invalid',name:'invalid',host:'127.0.0.1',port:1,transport:'telnet',telnet:{loginMode:'password'}};
  await assert.rejects(connectTelnet(env,{password:'password\rcommand'}),{code:'TELNET_CREDENTIAL_INVALID'});
});

test('manual test reports login unconfirmed; configured login tests prompt and closes its socket', async t=>{
  const dev=await device(t,socket=>socket.write('device> '));
  const {state}=await fixture(t,()=> '');
  await state.saveEnvironment({...dev.environment,telnet:{loginMode:'manual'}});
  const manual=await state.testEnvironment(dev.environment.id);
  assert.equal(manual.stages.find(x=>x.stage==='login-prompt').ok,null);
  await state.saveEnvironment(dev.environment);
  const checked=await state.testEnvironment(dev.environment.id);
  assert.equal(checked.login.state,'ready'); assert.equal(checked.capabilities.sftp,false);
  await until(()=>dev.sockets.size===0);
});

test('Telnet sessions expose protocol and logs, and reject SFTP and independent exec before dispatch', async t => {
  const dev = await device(t, socket => socket.write('device> '));
  const { state } = await fixture(t, () => '');
  await state.saveEnvironment(dev.environment);
  const session = await state.spawnBackend({ name: dev.environment.id, sessionId: 't-1' });
  t.after(() => session.close()); await session.loginReady;
  const record = { sessionId: 't-1', ownerId: OWNER.id, owner: OWNER, environment: dev.environment, session };
  state.sessions.set('t-1',record); state.trackTerminalLog(OWNER, 't-1',session,dev.environment);
  assert.match((await state.resize(OWNER, 't-1', 50, 120)).note, /NAWS is sent only when negotiated/);
  assert.equal(state.connectionSnapshot(record).kind,'telnet');
  assert.equal((await state.terminalOutput(OWNER,'t-1')).kind,'telnet');
  assert.equal((await state.listTerminalLogs(OWNER)).logs.find(log=>log.sessionId==='t-1').kind,'telnet');
  state.recordDisconnect(record, { reason: 'device closed' });
  assert.equal(state.events.get(OWNER.id).at(-1).kind, 'telnet.disconnected');
  await assert.rejects(state.execute(OWNER,'t-1',{command:'test'}), {code:'TELNET_EXEC_UNSUPPORTED'});
  await assert.rejects(state.connectFiles({kind:'ssh',environment:dev.environment.id}), {code:'TELNET_SFTP_UNSUPPORTED'});
});

test('mixed SSH/Telnet batches reject before opening or sending to any target', async t => {
  const { state, ctx } = await fixture(t, () => '');
  await state.saveEnvironment({ id: 'legacy', name: 'legacy', host: 'device', transport: 'telnet' });
  let opened = 0; state.open = async () => { opened++; throw Error('must not open'); };
  const tools = new Map();
  registerTools({ ...ctx, systemPrompt: { section() {} }, tools: { register: tool => tools.set(tool.name, tool) } }, state);
  await assert.rejects(tools.get('remote_terminal_batch').execute({ targets: ['ssh-first', 'legacy'], commands: ['show version'] }, { agent: OWNER }), { code: 'TELNET_LOGIN_REQUIRED' });
  assert.equal(opened, 0);
  assert.match(tools.get('remote_command_execute').parameters.properties.session.description, /For Telnet use remote_terminal_send/);
});
