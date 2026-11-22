// Real DSH + real SSH + a controlled GitHub HTTP fixture. Only the isolated
// host process redirects GitHub fetches; no production code or Agent is patched.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';
import { startFakeDevice } from '../harness/fake-device.mjs';

const cli = process.env.DSH_CLI, pkg = resolve(process.argv[2] ?? '');
if (!cli || !process.argv[2]) throw Error('Set DSH_CLI and pass the candidate tgz');
const out = resolve(process.env.GITHUB_UPDATE_OUTPUT ?? `output/github-update-native-${Date.now()}`);
await mkdir(out, { recursive: true });
const home = join(out, 'home'), profile = join(home, 'profiles/web');
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', REMOTE_OPS_ACCEPTANCE_KEY: 'isolated-fixture' };
const evidence = { kind: 'real-dsh-controlled-github-download', hostVersion: JSON.parse(await readFile(join(dirname(cli), '../package.json'), 'utf8')).version, steps: [], requests: [], errors: [] };
const until = async (fn, ms = 120000) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 200)); } throw Error('DSH acceptance timed out'); };
const run = (exe, args, options = {}) => new Promise((yes, no) => {
  const child = spawn(exe, args, { env, windowsHide: true, ...options }); let output = '';
  child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  child.on('error', no); child.on('close', code => code ? no(Error(output.slice(-6000))) : yes(output));
});
const step = async (name, work) => { await work(); evidence.steps.push({ name, passed: true }); console.log('PASS ' + name); };
const ssh = await startFakeDevice({ name: 'GitHub update SSH' });
let candidateVersion, version, bytes, digest, host, browser, page, owner, sshId, slowResponse, releaseSlow, api, update, base, mode = 'drop';
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/latest') return res.end(JSON.stringify({ tag_name: 'dsh-remote-ops-v' + version, assets: [`dsh-remote-ops-v${version}.tgz`, `SHA256SUMS-dsh-remote-ops-v${version}.txt`].map((name, index) => ({ name, id: 9000 + index, size: index ? 120 : bytes.length, digest: index ? undefined : 'sha256:' + digest, browser_download_url: `https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v${version}/${name}` })) }));
    if (req.url === '/sum') return res.end(`${digest}  dsh-remote-ops-v${version}.tgz\n`);
    if (req.url === '/redirect') return res.writeHead(302, { Location: 'https://release-assets.githubusercontent.com/acceptance.tgz?signature=fixture' }).end();
    if (req.url === '/asset') {
      const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? '')?.[1] ?? 0);
      evidence.requests.push({ offset, range: req.headers.range, ifRange: req.headers['if-range'], mode });
      res.writeHead(offset ? 206 : 200, { ETag: '"native-asset"', 'Content-Length': bytes.length - offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) });
      if (mode === 'drop') {
        for (let i = offset; i < offset + 1024 * 1024; i += 256 * 1024) { res.write(bytes.subarray(i, i + 256 * 1024)); await new Promise(r => setTimeout(r, 120)); }
        return res.destroy();
      }
      return res.end(bytes.subarray(offset));
    }
    if (req.url === '/api/slow') { slowResponse = res; releaseSlow = () => res.end('{"ok":true,"once":true}'); return; }
    // Deterministic test provider only creates an isolated conversation.
    for await (const _chunk of req) { /* Drain request without recording chat contents. */ }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ id: 'update-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '更新验收对话已就绪。' }, finish_reason: 'stop' }] }) + '\n\n'); res.end('data: [DONE]\n\n');
  } catch (error) { res.destroy(); evidence.errors.push(error.message); }
});

async function launch() {
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  host = spawn(process.execPath, ['--import', pathToFileURL(join(out, 'github-fixture.mjs')).href, cli, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { env, windowsHide: true });
  const log = join(out, `host-${host.pid}.log`); host.stdout.pipe(createWriteStream(log)); host.stderr.pipe(createWriteStream(join(out, `host-${host.pid}.error.log`)));
  const url = await until(async () => { if (host.exitCode !== null) throw Error('DSH exited'); return (await readFile(log, 'utf8').catch(() => '')).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0]; });
  await page.goto(url); await page.getByRole('textbox', { name: /描述你想要|发消息或创建任务/ }).waitFor();
  await page.getByRole('button', { name: 'Remote Ops', exact: true }).click(); await page.getByLabel('终端输出', { exact: true }).waitFor();
  api = (path, body) => page.evaluate(async ({ path, body }) => { const res = await fetch('/api/dsh-remote-ops/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const value = await res.json(); if (!res.ok) throw Error(JSON.stringify(value)); return value; }, { path, body });
  update = () => api('update');
}
const openUpdates = async () => { await page.getByLabel('设置', { exact: true }).click(); await page.getByRole('tab', { name: '更新', exact: true }).click(); await page.getByLabel('更新来源', { exact: true }).waitFor(); };
const stop = async () => { if (host && host.exitCode === null) { host.kill(); await new Promise(resolve => host.once('close', resolve)); } };
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'cordis.patch.yml'), `- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: ${base}/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Update acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text]\n`);
  await writeFile(join(out, 'install.log'), await run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', pkg]));
  candidateVersion = JSON.parse(await run('tar', ['-xOf', pkg, 'package/package.json'])).version;
  const numbers = candidateVersion.split('.').map(Number); numbers[2]++; version = numbers.join('.');
  const fixture = join(out, 'fixture'); await mkdir(fixture, { recursive: true }); await run('tar', ['-xzf', pkg, '-C', fixture]);
  await symlink(resolve('integrations/dsh-remote-ops/node_modules'), join(fixture, 'package/node_modules'), 'junction');
  for (const file of ['package.json', 'lib/version.js', 'lib/client.js']) { const path = join(fixture, 'package', file); await writeFile(path, (await readFile(path, 'utf8')).replaceAll(candidateVersion, version)); }
  const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await run(process.execPath, [npmCli, 'pack', '--silent', '--pack-destination', fixture], { cwd: join(fixture, 'package') });
  bytes = await readFile(join(fixture, `dsh-remote-ops-${version}.tgz`)); digest = createHash('sha256').update(bytes).digest('hex');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(pkg)) hash.update(chunk);
  evidence.packageSha256 = hash.digest('hex'); evidence.candidateVersion = candidateVersion; evidence.syntheticTargetVersion = version;
  await writeFile(join(out, 'github-fixture.mjs'), `const original=globalThis.fetch;globalThis.fetch=(input,options)=>{const url=String(input);let path;if(url==='https://api.github.com/repos/Ssshake1996/myterm/releases/latest')path='/latest';else if(url.startsWith('https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v${version}/'))path=url.endsWith('.tgz')?'/redirect':'/sum';else if(url.startsWith('https://release-assets.githubusercontent.com/acceptance.tgz?'))path='/asset';return original(path?${JSON.stringify(base)}+path:input,options);};`);
  browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
  page.on('request', req => { const u = new URL(req.url()); if (u.pathname.endsWith('/state') && u.searchParams.get('sessionId')) owner = u.searchParams.get('sessionId'); });
  page.on('pageerror', error => evidence.errors.push(error.message));
  await launch();
  await step('real DSH renders live GitHub bytes and automatic retry without repeated alerts', async () => {
    await openUpdates(); await page.getByRole('button', { name: '检查并更新', exact: true }).click();
    await until(async () => (await update()).download?.downloadedBytes > 0);
    await page.getByLabel('安装包下载进度').waitFor(); await page.screenshot({ path: join(out, 'download-progress.png') });
    await page.getByRole('button', { name: '返回工作区', exact: true }).click(); await page.getByLabel('终端输出', { exact: true }).waitFor(); await openUpdates();
    await until(async () => (await update()).phase === 'failed');
    const failed = await update(); assert.equal(failed.download.downloadedBytes, 4 * 1024 * 1024); assert.equal(failed.busy, false);
    assert.equal(evidence.requests.length, 4); await page.getByRole('button', { name: '继续下载', exact: true }).waitFor();
    evidence.retainedBytes = failed.download.downloadedBytes; await page.screenshot({ path: join(out, 'resume-after-failure.png') });
  });
  await step('DSH restart restores the pinned download without checking GitHub or installing', async () => {
    const requests = evidence.requests.length; await stop(); await launch(); await openUpdates();
    const value = await update(); assert.equal(value.download.downloadedBytes, evidence.retainedBytes); assert.equal(value.busy, false);
    await page.getByRole('button', { name: '继续下载', exact: true }).waitFor(); assert.equal(evidence.requests.length, requests);
  });
  let before, pending, editor;
  await step('establish real SSH and an active request before resuming the download', async () => {
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    editor = page.getByRole('textbox', { name: /描述你想要|发消息或创建任务/ }); await editor.fill('创建更新验收对话'); await editor.press('Enter');
    await until(async () => owner && (await api('state?sessionId=' + owner)).bound);
    await api('action', { action: 'environment.save', environment: { id: 'download-ssh', name: 'GitHub update SSH', group: 'native', host: ssh.host, port: ssh.port, username: ssh.username }, password: ssh.password });
    const opened = await api('action', { action: 'open', sessionId: owner, environment: 'download-ssh' }); sshId = opened.sessionId;
    const apiEnv = (await api('api', { action: 'environment.save', environment: { name: 'Update barrier', group: 'native', baseUrl: base + '/api/', timeoutMs: 120000, auth: { mode: 'none' } } })).result.id;
    pending = api('api', { action: 'request', sessionId: owner, args: { environment: apiEnv, path: 'slow', requestId: 'before-update' } }); pending.catch(() => {}); await until(() => slowResponse);
    before = await api('state?sessionId=' + owner); await editor.fill('更新后保留此草稿');
  });
  await step('resume uses Range and waits for work before installing, then hot reloads once', async () => {
    mode = 'complete'; await openUpdates(); await page.getByRole('button', { name: '继续下载', exact: true }).click();
    await until(async () => ['waiting-install', 'waiting'].includes((await update()).phase));
    assert.equal(evidence.requests.at(-1).offset, evidence.retainedBytes); assert.equal(evidence.requests.at(-1).ifRange, '"native-asset"');
    await page.screenshot({ path: join(out, 'waiting-for-work.png') }); releaseSlow(); await pending;
    const result = await until(async () => { try { const value = await update(); return value.currentVersion === version && value.installedVersion === version && !value.busy && value; } catch { return false; } }, 300000);
    assert.equal(host.exitCode, null); evidence.finalUpdate = result;
    const after = await api('state?sessionId=' + owner);
    assert.equal(after.sessions.find(item => item.sessionId === 'local-cmd').outputCursor.streamId, before.sessions.find(item => item.sessionId === 'local-cmd').outputCursor.streamId);
    const prior = before.sessions.find(item => item.sessionId === sshId), current = after.sessions.find(item => item.sessionId === sshId);
    assert.ok(current); assert.equal(current.outputCursor.streamId, prior.outputCursor.streamId);
    assert.equal(ssh.log.connections, 1);
    assert.match(await editor.innerText(), /更新后保留此草稿/);
    const reply = await api('action', { action: 'send', sessionId: owner, session: sshId, text: 'echo RESUMED_SSH_OK', quietMs: 500 }); assert.match(JSON.stringify(reply), /RESUMED_SSH_OK/);
    await page.screenshot({ path: join(out, 'update-applied.png') });
  });
  evidence.passed = true;
} catch (error) { evidence.error = error.stack; process.exitCode = 1; console.error(error.stack); await page?.screenshot({ path: join(out, 'failure.png') }).catch(() => {}); }
finally {
  releaseSlow?.(); await browser?.close().catch(() => {}); await stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); await ssh.close();
  await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(out);
}
