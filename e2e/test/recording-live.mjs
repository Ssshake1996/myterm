import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BrowserWorkspace } from '../../integrations/dsh-remote-ops/lib/browser-workspace.js';
import { registerBrowserTools } from '../../integrations/dsh-remote-ops/lib/browser-tools.js';

test('Agent signs in and reads and exports exact literal and parameterized passwords', { timeout: 60000 }, async t => {
  const passwords = ['  demo &+$" device  ', ' 设备 {{literal}} $&  '];
  let accepted = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const password = new URLSearchParams(body).get('field');
      const ok = password === passwords[accepted];
      if (ok) accepted++;
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
      // Echoing the input exercises redaction of subsequent Agent reads.
      res.end(ok ? 'Signed in\n' + password : 'Login rejected');
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const type = accepted === 0 ? 'password' : 'text';
      res.end(`<form method="post" action="/login"><label>Access<input id="field" name="field" type="${type}"></label><button>Sign in</button></form>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'remote-ops-password-'));
  const workspace = new BrowserWorkspace({ root, browserCacheRoot: join(root, 'cache') });
  t.after(async () => {
    await workspace.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const tools = new Map();
  registerBrowserTools({ tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section() {} } }, { browser: workspace });
  const owner = 'password-test';
  const call = (name, args) => tools.get(name).execute(args, { agent: { id: owner } });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { id: browserId, temporary } = await call('remote_browser_open', { url });
  assert.equal(temporary, true);
  const { id: recordingId } = await call('remote_browser_recording', { action: 'start', browserId });
  for (const [index, password] of passwords.entries()) {
    const job = await call('remote_browser_run', {
      browserId, requestId: 'sign-in-' + index,
      ...(index ? { variables: { password } } : {}),
      steps: [
        { action: 'goto', url },
        { action: 'fill', target: '#field', value: index ? '{{password}}' : password },
        { action: 'click', target: 'button', expect: { target: 'body', text: 'Signed in' } },
        { action: 'read', target: 'body' },
      ],
    });
    await workspace.session(owner, browserId).job.done;
    const result = await call('remote_browser_read', { browserId });
    assert.equal(result.browser.job.id, job.id);
    assert.equal(result.browser.job.status, 'completed', result.browser.job.error?.message);
    assert.match(result.page.text, /Signed in\s+\[redacted\]/);
    assert.ok(!JSON.stringify(result).includes(password));
  }
  assert.equal(accepted, 2);
  await call('remote_browser_recording', { action: 'stop', recordingId });
  const read = await call('remote_browser_recording', { action: 'read', recordingId, limit: 200 });
  const exported = await call('remote_browser_recording', { action: 'export', recordingId });
  const file = await readFile(exported.path, 'utf8');
  const fills = read.events.filter(event => event.source === 'agent' && event.details?.step?.action === 'fill');
  assert.deepEqual(fills.map(e => e.details.step.value), passwords);
  for (const [index, type] of ['password', 'text'].entries()) {
    assert.ok(read.events.some(event => event.kind === 'interaction' && event.action === 'fill' && event.target.type === type && event.input.value === passwords[index]));
  }
  assert.deepEqual(JSON.parse(file).events, read.events);
});

test('saved-site login records the resolved password and screenshots follow the native password visibility toggle', { timeout: 60000 }, async t => {
  const password = '  saved-fixture {{literal}} &  ';
  const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
    '<label>Account<input id="account"></label><label>Password<input id="pwd" type="password"></label>' +
    '<button id="login" onclick="document.getElementById(\'ok\').hidden=false">Login</button><output id="ok" hidden>Signed in</output>' +
    '<button id="reveal" onclick="document.getElementById(\'pwd\').type=\'text\'">Show password</button>'
  ));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'myterm-saved-password-')), values = new Map();
  const workspace = new BrowserWorkspace({ root, browserCacheRoot: join(root, 'cache'),
    credentials: { set: (ref, value) => values.set(ref, value), resolve: ref => ({ value: values.get(ref) }) } });
  t.after(async () => {
    await workspace.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); await rm(root, {recursive:true,force:true});
  });
  const site = await workspace.saveSite({ name:'Login fixture', url:`http://127.0.0.1:${server.address().port}/`, username:'demo',
    login:{username:'#account',password:'#pwd',submit:'#login',success:'#ok'} }, password);
  const owner = 'saved-test', opened = await workspace.open(owner,site.id,{display:'embedded'});
  const session = workspace.session(owner, opened.id), page = session.pages.get(session.activePageId);
  const rec = await workspace.recording(owner,{action:'start',browserId:opened.id});
  const job = await workspace.login(owner,opened.id); await job.done;
  assert.equal(job.status,'completed',job.error?.message);
  await workspace.recording(owner,{action:'stop',recordingId:rec.id});
  const { events } = JSON.parse((await workspace.recordings.export(owner,rec.id)).content);
  const fill = events.find(e=>e.details?.step?.target?.value==='#pwd');
  assert.equal(fill.details.step.value,password);
  assert.ok(!Object.hasOwn(fill.details.step,'secretRef'));
  assert.ok(events.some(e=>e.action==='fill'&&e.input?.value===password&&e.duringActionId===fill.actionId));
  assert.equal(await page.locator('#pwd').inputValue(),password);
  assert.equal(await page.locator('#pwd').getAttribute('type'),'password');
  const nativeShot = async () => {
    const expected = await page.screenshot({type:'png'});
    const {buffer} = await workspace.capture(session);
    assert.ok(buffer.equals(expected),'The plugin PNG must match Chromium’s own screenshot');
    return buffer;
  };
  const hidden = await nativeShot();
  await page.getByRole('button',{name:'Show password'}).click();
  assert.equal(await page.locator('#pwd').getAttribute('type'),'text');
  assert.ok(!(await nativeShot()).equals(hidden),'The revealed value must change the screenshot');
});

test('the package builder prepares a missing browser bundle offline and reuses it', {timeout:120000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'remote-ops-browser-prepare-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true});});
  const plugin=fileURLToPath(new URL('../../integrations/dsh-remote-ops/',import.meta.url));
  for(const directory of ['lib','scripts'])await mkdir(join(root,directory),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
  for (const file of ['lib/browser-runtime.js', 'lib/embedded-browser.js']) {
    await cp(join(plugin, file), join(root, file));
  }
  await cp(join(plugin,'scripts/bundle-browser-runtime.mjs'),join(root,'scripts/bundle-browser-runtime.mjs'));
  await symlink(join(plugin,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const run=()=>spawnSync(process.execPath,['scripts/bundle-browser-runtime.mjs'],{cwd:root,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:join(plugin,'browser/runtime',`${process.platform}-${process.arch}`),PLAYWRIGHT_DOWNLOAD_HOST:'http://127.0.0.1:9'},windowsHide:true,encoding:'utf8',timeout:60000});
  const first=run();assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/browser prepared/);
  const second=run();assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/already matches/);
});

test('bundled browser records genuine human/Agent events, cross-origin frames, popups and redaction', {timeout:60000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'remote-ops-recording-live-'));
  const server=createServer((request,response)=>{
    response.setHeader('Content-Type','text/html; charset=utf-8');
    if(request.url==='/frame'){response.end('<label>Frame input<input id="frame-entry"></label>');return;}
    if(request.url==='/popup'){response.end('<label>Popup input<input id="popup-entry"></label>');return;}
    response.end(`<title>Recording fixture</title><label>Name<input id="name"></label><label>Password<input id="password" type="password" oninput="document.querySelector('[role=alert]').textContent=this.value"></label><div role="alert"></div><label>API token<input id="token" name="api-token"></label><button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Save</button><output id="result"></output><canvas id="port-map" width="100" height="50"></canvas><a id="popup" href="/popup" target="_blank">Popup</a><iframe id="child" src="http://localhost:${server.address().port}/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,resolve));
  const w=new BrowserWorkspace({root,browserCacheRoot:join(root,'cache')});await w.ready;
  t.after(async()=>{await w.dispose();await new Promise(resolve=>server.close(resolve));assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true});});
  const opened=await w.openUrl('live',`http://127.0.0.1:${server.address().port}/?token=do-not-export`),record=w.session('live',opened.id),page=record.pages.get(record.activePageId);
  const runtime=await w.runtime();assert.equal(runtime.modes.embedded.source,'bundled');assert.equal(runtime.modes.embedded.ready,true);
  const started=await w.recording('live',{action:'start',browserId:opened.id,name:'Real document events'});
  await page.getByLabel('Name',{exact:true}).fill('human entry');await page.getByLabel('Name',{exact:true}).press('Control+A');await page.getByRole('button',{name:'Save'}).click();
  await page.getByLabel('Password',{exact:true}).fill('human-password-secret');
  await page.getByLabel('API token',{exact:true}).fill('human-api-token-secret');
  const longPassword = 'p'.repeat(16000) + '尾';
  await page.getByLabel('Password',{exact:true}).fill(longPassword);
  await page.getByLabel('Password',{exact:true}).press('Tab');
  await page.getByLabel('Password',{exact:true}).fill('');
  await page.getByLabel('Password',{exact:true}).press('Tab');
  await page.locator('#port-map').click({ position: { x: 25, y: 20 } });
  await page.frameLocator('#child').getByLabel('Frame input').fill('cross origin entry');
  const sharedValue = await w.run('live', opened.id, [
    { action: 'fill', target: '#password', value: '{{password}}' },
    { action: 'fill', target: '#token', value: 'fill' },
  ], { variables: { password: 'fill' } });
  await sharedValue.done; assert.equal(sharedValue.status, 'completed');
  const single=await w.run('live',opened.id,[{action:'fill',target:{kind:'css',value:'#name'},value:'single Agent fill'}]);await single.done;
  const singleEvents=(await w.recording('live',{action:'read',recordingId:started.id,limit:200})).events;
  const beforeSingle=singleEvents.find(event=>event.details?.step?.value==='single Agent fill');
  assert.ok(singleEvents.some(event=>event.input?.value==='single Agent fill'&&event.duringActionId===beforeSingle.actionId));
  const job=await w.run('live',opened.id,[{action:'fill',target:{kind:'css',value:'#name'},value:'agent entry'},{action:'click',target:{kind:'css',value:'#save'},expect:{target:{kind:'css',value:'#result'},text:'agent entry'}}]);await job.done;assert.equal(job.status,'completed');
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Popup'}).click();const popup=await popupPromise;
  await popup.getByLabel('Popup input').fill('popup entry');await popup.getByLabel('Popup input').press('Tab');
  await w.recording('live',{action:'stop',recordingId:started.id});
  const exported=await w.recordings.export('live',started.id),value=JSON.parse(exported.content);
  assert.ok(value.events.some(event=>event.source==='human'&&event.input?.value==='human entry'));
  assert.ok(value.events.some(event=>event.source==='agent'&&event.details?.step?.value==='agent entry'));
  assert.equal(value.recording.deviceOrigin, new URL(opened.url ?? page.url()).origin);
  assert.equal(value.recording.initialPages[0].devicePath, '/?token=%5Bredacted%5D');
  const external = value.events.find(event=>event.frame?.[0]?.selector==='#child'&&event.input?.value==='cross origin entry');
  assert.ok(external);
  assert.ok(!('devicePath' in external) && !('devicePath' in external.frame[0]));
  assert.ok(external.target.locators.some(locator => locator.kind === 'label' && locator.value === 'Frame input' && locator.match === 'unique'));
  assert.ok(value.events.some(event => event.kind === 'observation' && event.target.role === 'alert' && event.feedback.redacted));
  assert.ok(value.events.some(event => event.kind === 'observation' && event.target.role === 'status' && event.feedback.text === 'agent entry'));
  const point = value.events.find(event => event.target?.css === '#port-map' && event.action === 'click').pointer.relative;
  assert.ok(Math.abs(point.x * 100 - 25) <= 1 && Math.abs(point.y * 50 - 20) <= 1);
  assert.ok(value.events.some(event=>event.input?.value==='popup entry'&&event.pageId!==opened.pages[0].id));
  assert.ok(value.events.some(event=>event.result?.completion==='checked'));
  assert.ok(value.events.some(event=>event.duringActionId));
  assert.ok(!value.events.some(event=>event.key==='Control+Control'));
  assert.ok(value.events.some(event=>event.kind==='interaction'&&event.target?.type==='password'&&event.input?.value==='human-password-secret'));
  for (const entry of [longPassword, '']) assert.ok(value.events.some(event => event.target?.password && event.input?.value === entry && !event.input.truncated));
  assert.ok(value.events.some(event => event.target?.css === '#password' && event.input?.value === 'fill'));
  assert.ok(value.events.filter(event => event.target?.css === '#token' && event.action === 'fill').every(event => event.input.redacted));
  assert.ok(value.events.some(event => event.details?.step?.target?.value === '#token' && event.details.step.input?.redacted && !Object.hasOwn(event.details.step, 'value')));
  for(const secret of ['human-api-token-secret','do-not-export'])assert.ok(!exported.content.includes(secret),secret+' leaked');
  const before=value.events.length;await page.getByLabel('Name',{exact:true}).fill('after stopping');assert.equal((await w.recording('live',{action:'read',recordingId:started.id,limit:200})).events.length,before);
  const output=resolve('output/recording-live');await mkdir(output,{recursive:true});await writeFile(join(output,'recording.json'),exported.content);await writeFile(join(output,'page.png'),(await w.capture(record)).buffer);
  console.log(JSON.stringify({output,eventCount:before,runtime:runtime.modes.embedded.source}));
});
