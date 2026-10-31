// Installed candidate, unmodified DSH and Chrome, with isolated SSH fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';
import { startFakeDevice } from '../harness/fake-device.mjs';
import { verifyTerminalTabScroll } from '../scenarios/terminal-tab-scroll.mjs';
import { verifyEnvironmentManager } from '../scenarios/environment-manager.mjs';

const cli = process.env.DSH_CLI;
if (!cli || !process.argv[2]) throw Error('Set DSH_CLI and pass a candidate tgz');
const pkg = resolve(process.argv[2]), out = resolve(process.env.TERMINAL_TABS_OUTPUT ?? `output/playwright/terminal-tabs-native-${Date.now()}`);
await mkdir(out, { recursive: true });
const home = join(out, 'dsh-home'), profile = join(home, 'profiles/web');
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', REMOTE_OPS_ACCEPTANCE_KEY: 'isolated-test-fixture' };
const evidence = { kind: 'installed-candidate-native-dsh-scripted-ssh', packageSha256: createHash('sha256').update(await readFile(pkg)).digest('hex'), steps: [], errors: [] };
const ssh = await startFakeDevice({ name: 'Terminal tabs fixture' });
let host, browser, page, owner;
const logs = [];
const until = async predicate => { for (let i = 0; i < 300; i++) { const value = await predicate(); if (value) return value; await new Promise(r => setTimeout(r, 200)); } throw Error('Native DSH did not settle'); };
const model = createServer(async (req, res) => {
  for await (const _ of req) { /* Consume this isolated fixture request. */ }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ id: 'tab-scroll', object: 'chat.completion.chunk', created: 1, model: 'native-test', choices: [{ index: 0, delta: { role: 'assistant', content: '标签验证会话已就绪' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
const run = (args) => new Promise((yes, no) => {
  const child = spawn(process.execPath, [cli, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', v => output += v); child.stderr.on('data', v => output += v);
  child.once('error', no); child.once('close', code => code ? no(Error(output.slice(-4000))) : yes(output));
});
try {
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'cordis.patch.yml'), `- id: ui-settings-general
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
        baseURL: http://127.0.0.1:${model.address().port}/v1
        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY
        models:
          - id: native-test
            name: Terminal tabs acceptance
            contextWindow: 262144
            maxTokens: 4096
            input: [text]
`);
  await writeFile(join(out, 'install.log'), await run(['plugin', '--profile', 'web', 'add', pkg]));
  evidence.installedVersion = JSON.parse(await readFile(join(profile, 'node_modules/@dsh/remote-ops/package.json'), 'utf8')).version;
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  host = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  logs.push(createWriteStream(join(out, 'stdout.log')), createWriteStream(join(out, 'stderr.log'))); host.stdout.pipe(logs[0]); host.stderr.pipe(logs[1]);
  const url = await until(async () => { if (host.exitCode !== null) throw Error('DSH exited'); return (await readFile(join(out, 'stdout.log'), 'utf8').catch(() => '')).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0]; });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  evidence.browser = browser.version();
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1500, height: 1000 } }); page.setDefaultTimeout(20000);
  page.on('pageerror', e => evidence.errors.push(e.message));
  page.on('request', request => { const u = new URL(request.url()); if (u.pathname === '/api/dsh-remote-ops/state' && u.searchParams.get('sessionId')) owner = u.searchParams.get('sessionId'); });
  await page.goto(url);
  const editor = page.getByRole('textbox', { name: /描述你想要|发消息或创建任务/ });
  await editor.waitFor(); await editor.fill('验证终端标签滚动'); await editor.press('Enter');
  await page.getByRole('button', { name: 'Remote Ops', exact: true }).click();
  await page.getByLabel('终端输出', { exact: true }).waitFor(); await until(() => owner);
  const primaryOwner = owner;
  const action = body => page.evaluate(async body => {
    const response = await fetch('/api/dsh-remote-ops/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
  }, { sessionId: owner, ...body });
  const open = async index => {
    const id = 'tab-scroll-' + index;
    await action({ action: 'environment.save', environment: { id, name: '标签滚动测试环境 ' + (index + 1), host: ssh.host, port: ssh.port, username: ssh.username }, password: ssh.password });
    return action({ action: 'open', environment: id });
  };
  const step = async (name, work) => {
    await work(); evidence.steps.push({ name, passed: true }); console.log('PASS ' + name);
    await page.screenshot({ path: join(out, `step-${evidence.steps.length}.png`), animations: 'disabled' });
  };
  await verifyTerminalTabScroll({ page, step }, { open, send: () => action({ action: 'send', session: 'local-cmd', text: 'echo TAB_SCROLL_BACKGROUND', quietMs: 100 }) });
  await step('原生对话切换重建标签导航，保留其他对话连接与草稿', async () => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    for (let i = 0; i < 6; i++) await open(i);
    const strip = page.getByRole('tablist', { name: '终端会话' });
    await until(async () => await strip.getByRole('tab').count() === 7);
    await strip.getByRole('tab').first().focus(); await page.keyboard.press('End');
    await until(() => editor.isEditable()); await editor.fill('切换对话前保留的草稿');
    await page.getByRole('button', { name: '新建会话', exact: true }).last().click();
    await until(async () => {
      const key = await page.locator('[data-row-key^="session:"][aria-selected="true"]').getAttribute('data-row-key');
      return key && key !== 'session:' + primaryOwner && !await page.locator('.dsh-remote-ops').isVisible();
    });
    await editor.fill('验证第二个对话的标签'); await editor.press('Enter');
    await until(async () => (await editor.innerText()).trim() === '');
    if (!await page.locator('.dsh-remote-ops').isVisible()) await page.getByRole('button', { name: 'Remote Ops', exact: true }).click();
    await until(() => owner && owner !== primaryOwner);
    await until(async () => await strip.getByRole('tab').count() === 1);
    assert.equal(await page.getByRole('button', { name: '向左滚动终端标签', exact: true }).count(), 0);
    await page.locator(`[data-row-key="session:${primaryOwner}"]`).click();
    await until(async () => owner === primaryOwner && await strip.getByRole('tab').count() === 7);
    await until(() => page.getByRole('button', { name: '向右滚动终端标签', exact: true }).isVisible());
    assert.equal(await editor.innerText(), '切换对话前保留的草稿');
    assert.equal(await strip.locator('[aria-selected=true]').evaluate(node => { const r = node.getBoundingClientRect(), b = node.closest('[role=tablist]').getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; }), true);
  });
  const api = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch('/api/dsh-remote-ops/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
  }, { path, body: { sessionId: owner, ...body } });
  await verifyEnvironmentManager({ page, step }, { api, device: ssh, apiUrl: `http://127.0.0.1:${model.address().port}/api` });
  assert.deepEqual(evidence.errors, []);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.stack; process.exitCode = 1; console.error(error);
  evidence.failedView = await page?.locator('body').innerText({ timeout: 5000 }).catch(() => 'unavailable');
  await page?.screenshot({ path: join(out, 'failure.png'), animations: 'disabled' }).catch(() => {});
} finally {
  await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await browser?.close();
  if (host?.exitCode === null) await new Promise(r => { const child = spawn('taskkill.exe', ['/PID', String(host.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); child.once('error', r); child.once('close', r); });
  host?.stdout.destroy(); host?.stderr.destroy(); host?.unref(); logs.forEach(log => log.end());
  model.closeAllConnections(); await new Promise(r => model.close(r)); await ssh.close();
  console.log('Evidence: ' + join(out, 'evidence.json'));
}
