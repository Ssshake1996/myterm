import assert from 'node:assert/strict';

export async function verifyEnvironmentManager(t, { api, device, apiUrl }) {
  const p = t.page, panel = p.locator('.dsh-remote-ops');
  const manager = () => p.locator('.dsh-remote-ops__environmentManager:visible');
  const until = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await p.waitForTimeout(100); } throw Error('Environment manager did not settle'); };
  const row = name => manager().locator('[data-environment-row]').filter({ hasText: name });
  const environments = [
    { id: 'layout-prod-a', name: '布局生产 A', group: '布局生产' },
    { id: 'layout-prod-b', name: '布局生产 B', group: '布局生产' },
    { id: 'layout-test', name: '布局测试', group: '布局测试' },
  ];
  for (const environment of environments) await api('action', { action: 'environment.save', environment: { ...environment, host: device.host, port: device.port, username: device.username }, password: device.password ?? 'e2e-device-pass' });
  await api('action', { action: 'group.create', name: '布局空分组' });
  for (const suffix of ['A', 'B']) await api('api', { action: 'environment.save', environment: { name: '布局 API ' + suffix, group: '布局 API', baseUrl: apiUrl, auth: { mode: 'none' } } });
  await panel.getByRole('button', { name: '环境管理', exact: true }).click();
  await p.getByRole('tab', { name: 'SSH', exact: true }).click();
  await t.step('SSH 分组与环境分区，常用操作外露，删除仅在更多菜单中', async () => {
    await manager().getByRole('button', { name: '筛选分组 布局生产', exact: true }).click();
    assert.equal(await manager().locator('[data-environment-row]').count(), 2);
    for (const name of ['进入', '编辑', '测试 布局生产 A 连接']) assert.equal(await row('布局生产 A').getByRole('button', { name, exact: true }).isVisible(), true);
    assert.equal(await manager().getByRole('button', { name: /^删除/ }).count(), 0);
    const more = row('布局生产 A').getByRole('button', { name: '更多环境操作 布局生产 A', exact: true });
    await more.focus(); await p.keyboard.press('Enter');
    assert.equal(await manager().getByRole('button', { name: '新建独立连接', exact: true }).evaluate(node => document.activeElement === node), true);
    await p.keyboard.press('Escape');
    assert.equal(await more.evaluate(node => document.activeElement === node), true);
    assert.equal(await manager().getByRole('group', { name: '环境管理操作', exact: true }).count(), 0);
    await more.click();
    await manager().getByRole('button', { name: '删除环境', exact: true }).click();
    assert.match(await p.getByRole('dialog').innerText(), /布局生产 A/);
    assert.match(await p.getByRole('dialog').innerText(), /SSH 连接/);
    await p.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await manager().locator('[data-environment-row]').count(), 2);
  });
  await t.step('编辑返回保留搜索与分组，非空分组不可误删', async () => {
    await manager().getByLabel('搜索 SSH 环境', { exact: true }).fill('生产 A');
    await row('布局生产 A').getByRole('button', { name: '编辑', exact: true }).click();
    await p.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await manager().getByLabel('搜索 SSH 环境', { exact: true }).inputValue(), '生产 A');
    await manager().getByLabel('搜索 SSH 环境', { exact: true }).fill('');
    await manager().getByRole('button', { name: '分组操作 布局生产', exact: true }).click();
    assert.equal(await manager().getByRole('button', { name: '删除空分组', exact: true }).isDisabled(), true);
    await p.keyboard.press('Escape');
    await manager().getByRole('button', { name: '筛选分组 布局空分组', exact: true }).click();
    await manager().getByRole('button', { name: '分组操作 布局空分组', exact: true }).click();
    await manager().getByRole('button', { name: '删除空分组', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await until(async () => await manager().getByRole('button', { name: '筛选分组 布局空分组', exact: true }).count() === 0);
  });
  await t.step('批量管理只删除确认时选择的环境，取消不产生修改', async () => {
    await manager().getByRole('button', { name: '筛选分组 布局生产', exact: true }).click();
    await manager().getByRole('button', { name: '批量管理', exact: true }).click();
    await manager().getByLabel('选择当前结果', { exact: true }).check();
    await manager().getByRole('button', { name: '删除所选（2）', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await manager().locator('[data-environment-row]').count(), 2);
    await manager().getByRole('button', { name: '删除所选（2）', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await until(async () => await manager().locator('[data-environment-row]').count() === 0);
    await manager().getByRole('button', { name: '完成', exact: true }).click();
    await manager().getByRole('button', { name: '筛选分组 布局测试', exact: true }).click();
    assert.equal(await row('布局测试').count(), 1);
  });
  await t.step('API 使用同一列表与删除确认，使用环境后回到请求工作区', async () => {
    await p.getByRole('tablist', { name: '环境类型' }).getByRole('tab', { name: 'API', exact: true }).click();
    await manager().getByRole('button', { name: '筛选分组 布局 API', exact: true }).click();
    assert.equal(await manager().getByRole('button', { name: /^删除/ }).count(), 0);
    await row('布局 API A').getByRole('button', { name: '使用', exact: true }).click();
    await p.getByLabel('API 请求路径', { exact: true }).fill('unsent-draft');
    await panel.getByRole('button', { name: '环境管理', exact: true }).click();
    await row('布局 API B').getByRole('button', { name: '更多环境操作 布局 API B', exact: true }).click();
    await manager().getByRole('button', { name: '删除环境', exact: true }).click();
    assert.match(await p.getByRole('dialog').innerText(), /登录会话/);
    await p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await until(async () => await row('布局 API B').count() === 0);
    await p.getByRole('button', { name: '返回工作区', exact: true }).click();
    assert.equal(await p.getByLabel('API 请求路径', { exact: true }).inputValue(), 'unsent-draft');
  });
  await t.step('390px 窄栏使用分组选择，新增、编辑和返回入口可见', async () => {
    await panel.getByRole('button', { name: '环境管理', exact: true }).click();
    await p.setViewportSize({ width: 390, height: 844 }); await p.emulateMedia({ colorScheme: 'dark' });
    // Native DSH applies the responsive sidebar layout after the viewport event.
    await manager().getByLabel('API 环境分组', { exact: true }).waitFor({ state: 'visible' });
    assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    assert.equal(await manager().getByRole('button', { name: '新建 API 环境', exact: true }).isVisible(), true);
    assert.equal(await row('布局 API A').getByRole('button', { name: '编辑', exact: true }).isVisible(), true);
    assert.equal(await p.getByRole('button', { name: '返回工作区', exact: true }).isVisible(), true);
  });
}

export const environmentManagerScenario = { id: 'environment-manager', title: '统一环境管理、分组导航与批量删除', async run(t) {
  const p = t.page, info = await t.info();
  await p.getByRole('button', { name: 'Remote Ops', exact: true }).click(); await p.getByLabel('终端输出', { exact: true }).waitFor();
  const api = (path, body) => p.evaluate(async ({ path, body }) => {
    const response = await fetch('/api/dsh-remote-ops/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
  }, { path, body: { sessionId: info.sessionId, ...body } });
  await verifyEnvironmentManager(t, { api, device: info.device, apiUrl: info.website.url });
} };
