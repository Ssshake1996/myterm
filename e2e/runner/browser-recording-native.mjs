// Installed plugin, unmodified DSH, a scripted Agent and local fixture webpage.
// Browser download is deliberately disabled; npm dependencies may use their registry.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';

const cli = process.env.DSH_CLI;
if (!cli || !process.argv[2]) throw Error('Set DSH_CLI and pass a candidate tgz');
const pkg = resolve(process.argv[2]), out = resolve(process.env.RECORDING_NATIVE_OUTPUT ?? `output/recording-native-${Date.now()}`);
const bootstrap = process.env.BOOTSTRAP_PACKAGE && resolve(process.env.BOOTSTRAP_PACKAGE);
await mkdir(out, { recursive: true });
const profile = join(out, 'dsh-home/profiles/web'), cache = join(out, 'empty-browser-cache');
const env = { ...process.env, DSH_HOME: join(out, 'dsh-home'), DSH_TELEMETRY_DISABLED: '1', REMOTE_OPS_ACCEPTANCE_KEY: 'isolated-test-fixture', PLAYWRIGHT_BROWSERS_PATH: cache, PLAYWRIGHT_DOWNLOAD_HOST: 'http://127.0.0.1:9' };
const evidence = { kind: 'installed-candidate-native-dsh-web-recording', hostVersion: JSON.parse(await readFile(join(dirname(cli), '../package.json'), 'utf8')).version, packageSha256: createHash('sha256').update(await readFile(pkg)).digest('hex'), steps: [], errors: [] };
const until = async fn => { const end = Date.now() + 60000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 200)); } throw Error('Native browser acceptance did not settle'); };
const decode = value => { if (typeof value === 'string') { try { return decode(JSON.parse(value)); } catch { return value; } } if (Array.isArray(value)) return value.map(decode).find(item => item && typeof item === 'object') ?? value.map(decode).join('\n'); return value?.type === 'text' ? decode(value.text) : value; };
const proofs = new Map(), logs = [];
let host, browser, page, owner, recordingId;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/page') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<title>Web recording fixture</title><h3>Recording acceptance</h3><label for="entry">Name</label><input id="entry" style="position:absolute;left:20px;top:48px;width:240px;height:32px" oninput="document.querySelector(\'#result\').textContent=this.value"><button style="position:absolute;top:100px;left:20px" id="save" onclick="document.querySelector(\'#result\').textContent=\'Saved \'+document.querySelector(\'#entry\').value">Save</button><div id="result" style="position:absolute;top:150px"></div>'); return; }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), messages = body.messages ?? [];
    const at = messages.findLastIndex(item => item.role === 'user' && /RECORDING_NATIVE_(READY|RUN|READ)/.test(JSON.stringify(item.content)));
    const stage = at >= 0 ? /RECORDING_NATIVE_(READY|RUN|READ)/.exec(JSON.stringify(messages[at].content))[1] : 'NONE';
    const results = messages.slice(at + 1).filter(item => item.role === 'tool').map(item => decode(item.content));
    const plans = { READY: [['skill', { name: 'remote-ops-web-recordings' }], ['remote_browser_runtime', { action: 'status' }]], RUN: [['remote_browser_run', { steps: [{ action: 'fill', target: { kind: 'css', value: '#entry' }, value: 'Agent entry' }, { action: 'click', target: { kind: 'css', value: '#save' }, expect: { target: { kind: 'css', value: '#result' }, text: 'Saved Agent entry' } }] }]], READ: [['remote_browser_recording', { action: 'read', recordingId, limit: 200 }]] };
    const plan = plans[stage] ?? [];
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'recording-native', object: 'chat.completion.chunk', created: 1, model: 'native-test', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
    if (at >= 0 && body.tools?.length && results.length < plan.length && !results.some(item => typeof item === 'string' && item.startsWith('Error:'))) {
      const [name, args] = plan[results.length]; emit({ role: 'assistant', tool_calls: [{ index: 0, id: 'recording-' + results.length + '-' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); emit({}, 'tool_calls');
    } else { if (at >= 0 && body.tools?.length) proofs.set(stage, results); emit({ role: 'assistant', content: 'RECORDING_NATIVE_DONE' }, 'stop'); }
    res.end('data: [DONE]\n\n');
  } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
});
const run = args => new Promise((yes, no) => { const child = spawn(process.execPath, [cli, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value); child.once('error', no); child.once('close', code => code ? no(Error(output.slice(-4000))) : yes(output)); });
const step = async (name, work) => { await work(); evidence.steps.push({ name, passed: true }); console.log('PASS ' + name); await page?.screenshot({ path: join(out, `step-${evidence.steps.length}.png`), animations: 'disabled' }); };
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await mkdir(profile, { recursive: true });
  const documents = join(out, 'fixture-documents'); await mkdir(documents, { recursive: true });
  await writeFile(join(profile, 'cordis.patch.yml'), `- id: workspace-controller
  config:
    documentsDirectory: ${JSON.stringify(documents)}
- id: ui-settings-general
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: agent-default-model
  config:
    provider: remote-ops-acceptance
    model: native-test
- id: llm-pi-ai
  config:
    providers:
      remote-ops-acceptance:
        api: openai-completions
        baseURL: http://127.0.0.1:${server.address().port}/v1
        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY
        models:
          - id: native-test
            name: Web recording acceptance
            contextWindow: 262144
            maxTokens: 4096
            input: [text]
`);
  await step(bootstrap ? '安装正式旧版作为热升级基线' : '安装候选包：浏览器下载禁用、独立缓存为空', async () => {
    await writeFile(join(out, 'install.log'), await run(['plugin', '--profile', 'web', 'add', bootstrap ?? pkg]));
    evidence.installedVersion = JSON.parse(await readFile(join(profile, 'node_modules/@dsh/remote-ops/package.json'), 'utf8')).version;
    assert.deepEqual(await readdir(cache).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
  });
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  host = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  logs.push(createWriteStream(join(out, 'stdout.log')), createWriteStream(join(out, 'stderr.log'))); host.stdout.pipe(logs[0]); host.stderr.pipe(logs[1]);
  const url = await until(async () => { if (host.exitCode !== null) throw Error('DSH exited'); return (await readFile(join(out, 'stdout.log'), 'utf8').catch(() => '')).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0]; });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1500, height: 1000 } }); page.setDefaultTimeout(20000);
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/dsh-remote-ops/state' && url.searchParams.get('sessionId')) owner = url.searchParams.get('sessionId'); });
  await page.goto(url);
  const editor = page.getByRole('textbox', { name: /描述你想要|发消息或创建任务/ }); await editor.waitFor();
  const api = (path, body) => page.evaluate(async ({path,body}) => {
    const response = await fetch('/api/dsh-remote-ops/' + path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
    const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
  }, {path,body});
  if (bootstrap) await step('旧版活动网页经 CLI 安装和热激活保留，初始化录制能力', async () => {
    await editor.fill('Create isolated upgrade conversation'); await editor.press('Enter');
    await page.getByText('RECORDING_NATIVE_DONE',{exact:true}).last().waitFor();
    await page.getByRole('button',{name:'Remote Ops',exact:true}).click();
    await page.getByRole('tab',{name:'网页',exact:true}).click(); await until(()=>owner);
    const old = (await api('browser',{sessionId:owner,action:'open-url',url:`http://127.0.0.1:${server.address().port}/page`,display:'embedded',browser:'chrome'})).result;
    await page.getByAltText('网页实时画面',{exact:true}).waitFor();
    evidence.bootstrapVersion = evidence.installedVersion;
    await writeFile(join(out,'upgrade-install.log'),await run(['plugin','--profile','web','add',pkg]));
    evidence.installedVersion = JSON.parse(await readFile(join(profile,'node_modules/@dsh/remote-ops/package.json'),'utf8')).version;
    const update = await api('update');
    if (update.currentVersion !== evidence.installedVersion) await api('update',{action:'install'});
    await until(async()=>{try{return (await api('state?sessionId='+owner)).pluginVersion===evidence.installedVersion;}catch{return false;}});
    const current = (await api('browser?sessionId='+owner)).sessions.find(item=>!item.closed);
    assert.equal(current.id,old.id); assert.equal(current.pages[0].id,old.pages[0].id); assert.equal(host.exitCode,null);
  });
  const agent = async stage => { await until(() => editor.isEditable()); await editor.fill('RECORDING_NATIVE_' + stage); await editor.press('Enter'); return until(() => proofs.get(stage)); };
  await step('原生 Agent 能发现并读取随包 Skill，浏览器来源为 bundled', async () => {
    const results = await agent('READY');
    assert.match(String(results[0]), /<skill_content name="remote-ops-web-recordings">/);
    assert.equal(results[1].modes.embedded.source, 'bundled'); assert.equal(results[1].modes.embedded.ready, true);
  });
  await page.getByRole('button', { name: 'Remote Ops', exact: true }).click();
  await page.getByRole('tab', { name: '网页', exact: true }).click(); await until(() => owner);
  const snapshot = () => page.evaluate(async owner => (await fetch('/api/dsh-remote-ops/browser?sessionId=' + owner)).json(), owner);
  await step('全新安装直接打开插件内网页并开始录制', async () => {
    await page.getByRole('textbox', { name: '网页地址', exact: true }).fill(`http://127.0.0.1:${server.address().port}/page`);
    await page.getByRole('button', { name: '打开网页', exact: true }).click();
    await page.getByAltText('网页实时画面', { exact: true }).waitFor();
    await page.getByRole('button', { name: '开始网页录制', exact: true }).click();
    recordingId = (await snapshot()).sessions.find(item => !item.closed).recording.id; assert.ok(recordingId);
    if (bootstrap) { await page.getByRole('button',{name:'刷新网页',exact:true}).click(); await until(async()=>!await page.getByRole('button',{name:'刷新网页',exact:true}).isDisabled()); }
  });
  await step('原生 Agent 操作和人工网页输入均被记录', async () => {
    await agent('RUN');
    await until(async () => (await snapshot()).sessions.find(item => !item.closed)?.job?.status === 'completed');
    const current = (await snapshot()).sessions.find(item => !item.closed), image = page.getByAltText('网页实时画面', { exact: true }), bounds = await image.boundingBox();
    await image.click({ position: { x: 50 * bounds.width / current.viewport.width, y: 64 * bounds.height / current.viewport.height } });
    await page.keyboard.press('Control+A'); await page.keyboard.insertText('Human entry'); await page.keyboard.press('Tab');
    await page.getByRole('button', { name: '停止网页录制', exact: true }).click();
    await page.getByRole('button', { name: '开始网页录制', exact: true }).waitFor();
    const [saved] = await agent('READ');
    assert.ok(saved?.recording, JSON.stringify(saved));
    assert.equal(saved.recording.status, 'stopped');
    assert.ok(saved.events.some(item => item.source === 'agent' && item.details?.step?.value === 'Agent entry'));
    assert.ok(saved.events.some(item => item.input?.value === 'Human entry'));
    if (bootstrap) assert.ok(saved.events.some(item=>item.kind==='navigation'));
    evidence.eventCount = saved.events.length;
  });
  await step('界面读取和导出 JSON，刷新后录制仍可读', async () => {
    await page.getByRole('button', { name: '网页录制记录', exact: true }).click();
    await page.getByRole('button', { name: '读取记录', exact: true }).click();
    await page.getByLabel('网页录制记录', { exact: true }).getByText(/已读取/).waitFor();
    const waiting = page.waitForEvent('download'); await page.getByRole('link', { name: '导出 JSON', exact: true }).click();
    const download = await waiting; await download.saveAs(join(out, 'recording.json'));
    const exported = JSON.parse(await readFile(join(out, 'recording.json'), 'utf8'));
    assert.equal(exported.format, 'myterm.web-recording'); assert.equal(exported.events.length, evidence.eventCount);
    await page.reload(); await page.getByRole('button', { name: 'Remote Ops', exact: true }).click(); await until(() => owner);
    const result = await page.evaluate(async ({ owner, recordingId }) => (await fetch('/api/dsh-remote-ops/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: owner, action: 'recording', recording: { action: 'read', recordingId } }) })).json(), { owner, recordingId });
    assert.equal(result.result.recording.status, 'stopped');
  });
  assert.deepEqual(evidence.errors, []); evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.stack; process.exitCode = 1; console.error(error);
  evidence.agentProofs = Object.fromEntries(proofs);
  evidence.failedView = await page?.locator('body').innerText({ timeout: 5000 }).catch(() => 'unavailable');
  await page?.screenshot({ path: join(out, 'failure.png'), animations: 'disabled' }).catch(() => {});
} finally {
  await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); await browser?.close();
  if (host?.exitCode === null) {
    if (process.platform === 'win32') await new Promise(r => { const child = spawn('taskkill.exe', ['/PID', String(host.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); child.once('error', r); child.once('close', r); });
    else host.kill('SIGTERM');
  }
  host?.stdout.destroy(); host?.stderr.destroy(); host?.unref(); logs.forEach(log => log.end());
  server.closeAllConnections(); await new Promise(r => server.close(r));
  console.log('Evidence: ' + join(out, 'evidence.json'));
}
