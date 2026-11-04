import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, OWNER } from './helpers.mjs';
import { validateEnvironment } from '../lib/common.js';
import { registerTools } from '../lib/tools.js';

const definition = { id: 'console', name: 'Console', transport: 'serial', serial: { path: 'COM7', baudRate: 115200 } };
const toolset = (ctx, state) => {
  const tools = new Map();
  registerTools({ ...ctx, systemPrompt: { section() {} }, tools: { register: tool => tools.set(tool.name, tool) } }, state);
  return tools;
};

test('SERIAL accepts a device path without host or credentials and rejects invalid framing and unsafe paths', () => {
  for (const path of ['COM12', '/dev/ttyUSB0', '/dev/cu.usbserial-001', '/dev/serial/by-id/usb-FTDI_123', '/dev/pts/4']) {
    assert.equal(validateEnvironment({ ...definition, serial: { path } }).ok, true, path);
  }
  for (const serial of [{}, {path:'../test'}, {path:'/etc/passwd'}, {path:'/dev/null'}, {path:'/dev/tty/../../etc/passwd'},
    {path:'COM0'}, {path:'COM7',baudRate:0}, {path:'COM7',parity:'oops'}, {path:'COM7',dataBits:9},
    {path:'COM7',stopBits:3}, {path:'COM7',flowControl:'auto'}, {path:'COM7',lineEnding:'bad'}]) {
    assert.equal(validateEnvironment({ ...definition, serial }).ok, false, JSON.stringify(serial));
  }
  assert.equal(validateEnvironment({id:'old',name:'ssh',transport:'ssh'}).ok,false);
});

test('Agent creates and edits serial settings, reloads them and changes protocol without stale credentials or endpoints', async t => {
  const {ctx,state} = await fixture(t, ()=>'');
  const tools=toolset(ctx,state), create=tools.get('remote_environment_create'), args={transport:'serial',serial:definition.serial};
  assert.equal(new Ajv({strict:true}).compile(create.parameters)(args),true);
  const saved=(await create.execute(args,{agent:OWNER})).environment;
  assert.equal(saved.name,'COM7');
  await state.updateEnvironment(saved.id,{serial:{baudRate:9600}});
  state.environments.clear(); await state.load();
  assert.equal(state.findEnvironment(saved.id).serial.path,'COM7');
  assert.equal(state.findEnvironment(saved.id).serial.baudRate,9600);
  const ssh=await state.updateEnvironment(saved.id,{transport:'ssh',host:'router',username:'user',passwordRef:'EXISTING'});
  assert.equal(ssh.serial,undefined); assert.equal(ssh.passwordRef,'EXISTING');
  const serial=await state.updateEnvironment(saved.id,{transport:'serial',serial:{path:'/dev/ttyUSB0'}});
  assert.equal(serial.host,undefined); assert.equal(serial.passwordRef,undefined);
  assert.equal(serial.username,undefined); assert.equal(serial.port,undefined);
  await assert.rejects(create.execute({...args,name:'bad',password:'unused'},{agent:OWNER}),{code:'REMOTE_ENV_INVALID'});
  assert.ok(tools.has('remote_serial_ports'));
});

test('serial session shares device bytes, enforces exclusive open, preserves encoding and releases for reconnect', async t => {
  const {connectSerial} = await import('../lib/serial-connection.js');
  const {SerialPortMock} = await import('serialport');
  const {default:iconv} = await import('iconv-lite');
  SerialPortMock.binding.createPort('COM7',{record:true,maxReadSize:1});
  const leases=new Set(), options={Port:SerialPortMock,leases};
  const env={...definition,encoding:'gb18030',serial:{...definition.serial,lineEnding:'crlf'}};
  const session=await connectSerial(env,options);
  t.after(()=>session.close());
  await assert.rejects(connectSerial({...env,id:'other'},options),{code:'SERIAL_PORT_BUSY'});
  const sent=session.startSend({text:'查看',submit:true,quietMs:25,timeoutMs:500});
  const receipt=await sent.done;
  assert.equal(receipt.completion,'unknown');
  assert.deepEqual(session.channel.port.recording,iconv.encode('查看\r\n','gb18030'));
  session.channel.port.emitData(iconv.encode('设备正常\r\n','gb18030'));
  for(let i=0;i<50&&!session.output.includes('设备正常');i++) await delay(5);
  assert.match(session.output,/设备正常/);
  await session.writeInput('human'); await session.signal('SIGINT');
  assert.deepEqual(session.channel.port.recording,iconv.encode('查看\r\nhuman\x03','gb18030'));
  await session.close(); assert.equal(leases.size,0);
  const next=await connectSerial(env,options); await next.close();
});

test('failed driver open releases the path; cancelled pending open closes its late handle before reuse', async () => {
  const {connectSerial} = await import('../lib/serial-connection.js');
  const {SerialPortMock} = await import('serialport');
  const leases = new Set(), env = {...definition,serial:{path:'COM84'}};
  await assert.rejects(connectSerial(env,{leases,Port:SerialPortMock}));
  assert.equal(leases.size,0);
  SerialPortMock.binding.createPort('COM84',{record:true});
  let begin;
  class DelayedPort extends SerialPortMock {
    open(callback) { begin = () => super.open(callback); }
  }
  const controller = new AbortController();
  const pending = connectSerial(env,{leases,Port:DelayedPort,signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(connectSerial(env,{leases,Port:SerialPortMock}),{code:'SERIAL_PORT_BUSY'});
  begin();
  for(let i=0;i<50 && leases.size;i++) await delay(5);
  assert.equal(leases.size,0);
});

test('an unplug ends the shared stream and releases the lease without sending more bytes', async () => {
  const {connectSerial} = await import('../lib/serial-connection.js');
  const {SerialPortMock} = await import('serialport');
  const env = {...definition,serial:{path:'COM85'}}, leases = new Set();
  SerialPortMock.binding.createPort('COM85');
  const session = await connectSerial(env,{leases,Port:SerialPortMock});
  const event = new Promise(resolve=>{session.onClose=resolve;});
  session.channel.close(undefined,Object.assign(Error('Device disconnected'),{disconnected:true}));
  assert.match((await event).reason,/disconnected/i);
  assert.equal(session.status().kind,'exited'); assert.equal(leases.size,0);
  await assert.rejects(session.writeInput('never sent'),{code:'REMOTE_SESSION_EXITED'});
});

test('SERIAL excludes SSH-only operations and keeps mixed batches from partially dispatching', async t => {
  const {state,ctx} = await fixture(t,()=>'');
  await state.saveEnvironment(definition);
  state.sessions.set('serial-session',{sessionId:'serial-session',ownerId:OWNER.id,environment:definition,session:{status:()=>({kind:'running'})}});
  await assert.rejects(state.execute(OWNER,'serial-session',{command:'show version'}),{code:'SERIAL_EXEC_UNSUPPORTED'});
  await assert.rejects(state.connectFiles({kind:'ssh',environment:definition.id}),{code:'SERIAL_SFTP_UNSUPPORTED'});
  const tools = toolset(ctx,state);
  let opens=0; state.open=async()=>{opens++;};
  await assert.rejects(tools.get('remote_terminal_batch').execute({targets:['other',definition.id],commands:['show']},{agent:OWNER}),{code:'SERIAL_BATCH_UNSUPPORTED'});
  assert.equal(opens,0);
});
