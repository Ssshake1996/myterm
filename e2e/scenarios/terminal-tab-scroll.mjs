import assert from 'node:assert/strict';

// Shared by the browser harness and the installed, native DSH acceptance runner.
// Mouse clicks must use the arrows: Playwright must not scroll a hidden tab for us.
export async function verifyTerminalTabScroll(t, { open, send }) {
  const p = t.page, panel = p.locator('.dsh-remote-ops');
  const strip = panel.getByRole('tablist', { name: '终端会话' });
  const tabs = () => strip.getByRole('tab');
  const left = panel.getByRole('button', { name: '向左滚动终端标签', exact: true });
  const right = panel.getByRole('button', { name: '向右滚动终端标签', exact: true });
  const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await p.waitForTimeout(100); }
    throw Error('Terminal tab scrolling did not settle');
  };
  const inside = tab => tab.evaluate(node => {
    const r = node.getBoundingClientRect(), b = node.closest('[role=tablist]').getBoundingClientRect();
    return r.left >= b.left - 1 && r.right <= b.right + 1;
  });
  const position = () => strip.evaluate(node => node.scrollLeft);
  const settled = async () => {
    let previous = await position(), stable = 0;
    await until(async () => { const current = await position(); stable = Math.abs(current - previous) < .1 ? stable + 1 : 0; previous = current; return stable >= 3; });
  };
  const walk = async (button, direction) => {
    await settled();
    for (let i = 0; i < 80 && !await button.isDisabled(); i++) {
      const before = await position(); await button.click();
      await until(async () => await button.isDisabled() || direction * (await position() - before) > 1);
      await settled();
    }
    await until(() => button.isDisabled());
  };
  await t.step('单终端不显示多余滚动按钮', async () => {
    assert.equal(await tabs().count(), 1);
    assert.equal(await left.count(), 0); assert.equal(await right.count(), 0);
  });
  await t.step('十二个 SSH 标签溢出后显示箭头，保持同一行', async () => {
    for (let i = 0; i < 12; i++) await open(i);
    await until(async () => await tabs().count() === 13);
    await tabs().first().focus(); await p.keyboard.press('End');
    await until(() => inside(tabs().last()));
    assert.equal(await left.isVisible(), true); await until(() => right.isDisabled());
    assert.ok((await panel.locator('.dsh-remote-ops__terminalHead').boundingBox()).height <= 40);
  });
  await t.step('仅点击左箭头回到最早标签，不关闭连接、不切换当前终端', async () => {
    const active = await strip.locator('[aria-selected=true]').getAttribute('id');
    const actions = await panel.locator('.dsh-remote-ops__terminalActions').boundingBox();
    await walk(left, -1);
    assert.equal(await inside(tabs().first()), true);
    assert.equal(await tabs().count(), 13);
    assert.equal(await strip.locator('[aria-selected=true]').getAttribute('id'), active);
    const after = await panel.locator('.dsh-remote-ops__terminalActions').boundingBox();
    assert.equal(after.x, actions.x); assert.equal(after.y, actions.y);
  });
  await t.step('后台输出和状态轮询不把手动滚动位置拉回活动标签', async () => {
    const before = await position();
    await send(); await p.waitForTimeout(3500);
    assert.ok(Math.abs(await position() - before) <= 1);
    assert.equal(await left.isDisabled(), true);
    assert.equal(await inside(tabs().first()), true);
    await tabs().first().click();
    assert.equal(await tabs().first().getAttribute('aria-selected'), 'true');
  });
  await t.step('连续点击右箭头可达末尾，键盘 Home 与 End 保持目标可见', async () => {
    await right.click({ clickCount: 3, delay: 35 });
    await until(async () => await position() > 1);
    await walk(right, 1);
    assert.equal(await inside(tabs().last()), true);
    assert.equal(await tabs().first().getAttribute('aria-selected'), 'true');
    await tabs().last().click();
    await tabs().last().focus(); await p.keyboard.press('Home');
    await until(() => inside(tabs().first()));
    assert.equal(await tabs().first().getAttribute('aria-selected'), 'true');
    await p.keyboard.press('End'); await until(() => inside(tabs().last()));
    assert.equal(await tabs().last().getAttribute('aria-selected'), 'true');
  });
  await t.step('窄屏、深色和减少动画模式下箭头及活动标签仍可用', async () => {
    await p.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await p.setViewportSize({ width: 390, height: 844 });
    await until(() => inside(tabs().last()));
    assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const head = await panel.locator('.dsh-remote-ops__terminalHead').boundingBox();
    assert.ok(head.height <= 40);
    for (const button of [left, right, panel.getByRole('button', { name: '导出当前终端 TXT', exact: true })]) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.x >= head.x && bounds.x + bounds.width <= head.x + head.width + 1);
    }
    await walk(left, -1); assert.equal(await inside(tabs().first()), true);
    await tabs().first().click();
    await walk(right, 1); assert.equal(await inside(tabs().last()), true);
    await tabs().last().click();
  });
  await t.step('关闭活动标签后恢复可见选中项，剩余单终端时隐藏箭头', async () => {
    await strip.locator('.dsh-remote-ops__tabClose').last().click();
    await p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await until(async () => await tabs().count() === 12);
    await until(() => inside(strip.locator('[aria-selected=true]')));
    await panel.getByRole('button', { name: '全部关闭 SSH 标签', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await until(async () => await tabs().count() === 1);
    await until(async () => await left.count() === 0 && await right.count() === 0);
    assert.equal(await tabs().first().getAttribute('aria-selected'), 'true');
    assert.equal(await inside(tabs().first()), true);
    await p.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await p.setViewportSize({ width: 1280, height: 800 });
  });
}

export const terminalTabScrollScenario = { id: 'terminal-tab-scroll', title: '多终端标签左右滚动、边界与后台刷新', async run(t) {
  const p = t.page, info = await t.info();
  await p.getByRole('button', { name: 'Remote Ops', exact: true }).click();
  await p.getByLabel('终端输出', { exact: true }).waitFor();
  const action = body => p.evaluate(async body => {
    const response = await fetch('/api/dsh-remote-ops/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
  }, { sessionId: info.sessionId, ...body });
  await verifyTerminalTabScroll(t, {
    open: async index => {
      const id = 'tab-scroll-' + index;
      await action({ action: 'environment.save', environment: { id, name: '标签滚动测试环境 ' + (index + 1), host: info.device.host, port: info.device.port, username: info.device.username }, password: 'e2e-device-pass' });
      return action({ action: 'open', environment: id });
    },
    send: () => action({ action: 'send', session: 'local-cmd', text: 'echo TAB_SCROLL_BACKGROUND', quietMs: 100 }),
  });
} };
