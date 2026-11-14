import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const titles = { overview: '设备概览', ports: '端口状态', legacy: '固定宽度设备', compact: '定宽设备控制台', framed: '设备内嵌表单' };

export function serveLayoutFixture(path, response, origin) {
  const name = path.split('/').at(-1);
  if (path === '/panel/form') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><style>*{box-sizing:border-box}body{margin:0}main{width:1060px;height:100vh;position:relative}button{position:absolute;right:5px;bottom:5px;width:80px;height:40px}</style><main><button id="apply">应用设置</button></main><script>apply.onclick=()=>parent.postMessage("applied","*")</script>');
    return true;
  }
  if (!path.startsWith('/panel/') || !Object.hasOwn(titles, name)) return false;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (name === 'framed') {
    response.end(`<!doctype html><title>${titles.framed}</title><style>*{box-sizing:border-box}body{margin:0}header{height:48px}section{height:calc(100vh - 48px);display:flex}nav{width:180px;flex:none}iframe{border:0;flex:1;min-width:0}output{display:block}</style>
      <header>设备设置 <output></output></header><section><nav>系统</nav><iframe src="${origin.replace('127.0.0.1', 'localhost')}/panel/form"></iframe></section>
      <script>onmessage=e=>{const frame=document.querySelector('iframe');if(e.source===frame?.contentWindow&&e.data==='applied'){document.querySelector('output').textContent='设置已应用';frame.remove();}}</script>`);
    return true;
  }
  response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>${titles[name]}</title>
    <style>*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui;color:#233643;background:#eef3f4}
    main{height:100vh;${name === 'compact' ? 'width:320px;' : ''}min-width:${name === 'legacy' ? '1100px' : '0'};position:relative;padding:56px 6%;background:linear-gradient(#f7fafa,#e2ecee)}
    h1{font-size:24px;margin:6px 0 20px}p{margin:0}table{width:100%;background:white;border-collapse:collapse}th,td{border-bottom:1px solid #d4e0e3;padding:8px;text-align:left}
    button{position:absolute;background:#235565;color:white;border:0;border-radius:4px;width:64px;height:36px}
    .t{top:3px}.b{bottom:3px}.l{left:3px}.r{right:3px}footer{padding:30px}</style>
    <main><p>设备管理</p><h1>${titles[name]}</h1><table><tr><th>接口</th><th>状态</th><th>速率</th></tr><tr><td>GE 1/0/1</td><td>已连接</td><td>1 Gbps</td></tr><tr><td>GE 1/0/2</td><td>已连接</td><td>1 Gbps</td></tr></table>
    ${[['tl','左上'],['tr','右上'],['bl','左下'],['br','右下']].map(([id,label]) => `<button id="${id}" class="${id[0]} ${id[1]}">${label}</button>`).join('')}
    <input id="draft" aria-label="设备名称"><output id="last"></output></main>${name === 'compact' ? '' : '<footer>接口列表末尾</footer>'}
    <script>draft.oninput=()=>last.textContent=draft.value;document.onclick=e=>{if(e.target.tagName==='BUTTON')last.textContent='hit-'+e.target.id}</script></html>`);
  return true;
}

export async function checkBrowserLayout({ page, owner, api, snapshot, until, step, url, out, evidence }) {
  const active = async () => {
    const state = await snapshot();
    return state.sessions.find(session => session.id === state.activeBrowserId && !session.closed);
  };
  const image = page.getByAltText('网页实时画面', { exact: true });
  const list = page.getByRole('tablist', { name: '网页标签页' });
  const add = page.getByRole('button', { name: '新建网页', exact: true });
  const open = async (name, newTab = false) => {
    if (newTab) {
      await add.click();
      await list.getByRole('tab', { name: '新标签页', selected: true, exact: true }).waitFor();
    }
    await page.getByRole('textbox', { name: '网页地址' }).fill(url + '/panel/' + name);
    await page.getByRole('button', { name: '打开网页', exact: true }).click();
    await list.getByRole('tab', { name: titles[name], exact: true, selected: true }).waitFor();
  };
  const geometry = async (fixed = false) => until(async () => {
    const current = await active();
    const box = await image.evaluate(node => {
      const surface = node.parentElement, rect = node.getBoundingClientRect();
      return { w: surface.clientWidth, h: surface.clientHeight, imageW: rect.width, imageH: rect.height, encodedW: node.naturalWidth, revision: Number(node.dataset.revision) };
    });
    if (!box.encodedW || box.revision !== current.revision || Math.abs(box.imageW - box.w) > 2 || Math.abs(box.imageH - box.h) > 2) return false;
    const { width, height } = current.viewport;
    if (typeof fixed === 'number') {
      if (width !== fixed || Math.abs(height - fixed * box.h / box.w) > 1) return false;
    } else if (fixed ? width < 1100 : Math.abs(width - box.w) > 1 || Math.abs(height - box.h) > 1) return false;
    return { ...box, width, height };
  });
  const record = (action, recordingId) => api('browser', { sessionId: owner, action: 'recording', recording: { action, recordingId, ...(action === 'read' ? { limit: 200 } : {}) } });
  const corners = async model => {
    const { id } = (await record('start')).result, expected = [];
    for (const [target, right, bottom] of [['tl',false,false],['tr',true,false],['bl',false,true],['br',true,true]]) {
      const x = right ? model.width - 30 : 30, y = bottom ? model.height - 17 : 17;
      await image.click({ position: { x: x * model.imageW / model.width, y: y * model.imageH / model.height } });
      await until(async () => (await api('browser', { sessionId: owner, action: 'observe' })).result.text.includes('hit-' + target));
      expected.push({ target, x, y });
    }
    await record('stop', id);
    const { events } = (await record('read', id)).result;
    for (const { target,x,y } of expected) assert.ok(events.some(event => event.action === 'click' && event.target?.css === '#' + target && Math.abs(event.pointer.x-x)<4 && Math.abs(event.pointer.y-y)<4), 'Recorded coordinates for ' + target);
    return expected.length;
  };
  await page.getByRole('tab', { name: '网页', exact: true }).click();
  await step('拖动真实 DSH 分栏，设备网页随面板重新排版', async () => {
    await open('overview');
    const initial = await geometry();
    await api('browser', { sessionId: owner, action: 'run', steps: [{ action: 'fill', target: '#draft', value: '保留草稿', expect: { target: '#last', text: '保留草稿' } }] });
    await until(async () => (await active()).job?.status === 'completed');
    const divider = await page.locator('[data-side="rightbar"]').boundingBox();
    assert.ok(divider);
    evidence.panelLayout = { initial };
    const x = divider.x + divider.width / 2, y = divider.y + divider.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    const heldWidths = [];
    await page.mouse.move(x + (initial.w - 390) / 2, y, { steps: 6 });
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + (initial.w - 390) * (0.5 - i * 0.07), y);
      const box = await image.evaluate(n => {
        const b = n.getBoundingClientRect(), p = n.parentElement.getBoundingClientRect();
        return { width: p.width, right: p.right - b.right, bottom: p.bottom - b.bottom };
      });
      assert.ok(Math.abs(box.right) < 2 && Math.abs(box.bottom) < 2, JSON.stringify(box));
      heldWidths.push((await active()).viewport.width);
      await new Promise(resolve => setTimeout(resolve, 45));
    }
    assert.ok(new Set(heldWidths).size > 1, 'Chromium must reflow before the divider is released');
    evidence.panelLayout.heldWidths = heldWidths;
    await page.mouse.move(x + initial.w - 390, y, { steps: 14 }); await page.mouse.up();
    await until(async () => Math.abs(await image.evaluate(node => node.parentElement.clientWidth) - 390) < 8);
    const narrow = await geometry();
    assert.ok(narrow.w <= 430 && narrow.w >= 300, JSON.stringify(narrow));
    evidence.panelLayout.narrow = narrow;
    const window = page.viewportSize();
    await page.setViewportSize({ width: window.width - 120, height: window.height - 160 });
    const resized = await geometry();
    assert.ok(resized.h < narrow.h - 100 && (await api('browser', { sessionId: owner, action: 'observe' })).result.text.includes('保留草稿'));
    await page.setViewportSize(window);
    await geometry();
  });
  await step('跨域设备表单右下按钮可点击，单页切换后视口恢复', async () => {
    await open('framed');
    const frame = await geometry(true);
    assert.ok(frame.width >= 1240);
    const { id } = (await record('start')).result;
    await image.click({ position: { x: (frame.width - 45) * frame.imageW / frame.width, y: (frame.height - 25) * frame.imageH / frame.height } });
    await until(async () => (await api('browser', { sessionId: owner, action: 'observe' })).result.text.includes('设置已应用'));
    await record('stop', id);
    const { events } = (await record('read', id)).result;
    assert.ok(events.some(e => e.action === 'click' && e.target?.css === '#apply' && e.frame?.length));
    evidence.panelLayout.framed = frame;
    evidence.panelLayout.afterSwitch = await geometry();
    await open('overview');
  });
  await step('侧栏变宽时放大窄设备网页，四角点击与元素操作命中同一标签', async () => {
    await open('compact');
    const initial = await geometry(320);
    const tabId = (await active()).activePageId;
    const divider = await page.locator('[data-side="rightbar"]').boundingBox();
    const x = divider.x + divider.width / 2, y = divider.y + divider.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const samples = [];
    try {
      for (const dx of [80,160,240]) {
        await page.mouse.move(x - dx, y, { steps: 6 });
        const model = await geometry(320);
        assert.ok(model.w > (samples.at(-1) ?? initial).w + 25);
        samples.push(model);
      }
    } finally { await page.mouse.up(); }
    evidence.panelLayout.compactHeld = samples;
    evidence.panelLayout.compactCorners = await corners(samples.at(-1));
    await api('browser', { sessionId: owner, action: 'run', pageId: tabId, steps: [
      { action: 'fill', target: '#draft', value: '同一标签', expect: { target: '#last', text: '同一标签' } },
    ] });
    await until(async () => (await active()).job?.status === 'completed');
    assert.equal((await active()).activePageId, tabId);
    assert.ok((await api('browser', { sessionId: owner, action: 'observe' })).result.text.includes('同一标签'));
    await page.locator('.dsh-remote-ops__webBrowser').screenshot({ path: join(out, 'compact-fit.png') });
    const moved = await page.locator('[data-side="rightbar"]').boundingBox();
    await page.mouse.move(moved.x + moved.width / 2, y); await page.mouse.down();
    try { await page.mouse.move(x, y, { steps: 12 }); } finally { await page.mouse.up(); }
    await open('overview'); await geometry();
  });
  await step('固定宽度设备适宽显示，四角点击与录制对应', async () => {
    await open('ports', true); await open('legacy', true);
    const fixed = await geometry(true);
    evidence.panelLayout.legacy = fixed;
    evidence.panelLayout.legacyCorners = await corners(fixed);
    await page.locator('.dsh-remote-ops__webBrowser').screenshot({ path: join(out,'narrow-tabs.png') });
  });
  await step('逐标签关闭、键盘切换和溢出后激活标签可见', async () => {
    const closePorts = page.getByRole('button', { name: '关闭网页标签 ' + titles.ports, exact: true });
    for (const button of [closePorts, add]) {
      const box = await button.boundingBox();
      assert.ok(box.width >= 32 && box.height >= 32);
    }
    await closePorts.click();
    await until(async () => await list.getByRole('tab').count() === 2);
    await list.getByRole('tab', { name: titles.legacy, selected: true }).waitFor();
    for (let i = 0; i < 4; i++) {
      const count = await list.getByRole('tab').count();
      await add.click(); await until(async () => await list.getByRole('tab').count() === count + 1);
    }
    const selected = list.getByRole('tab', { selected: true });
    const visible = () => selected.evaluate(node => {
      const parent = node.closest('[role=tablist]'), area = parent.getBoundingClientRect(), tab = node.parentElement.getBoundingClientRect();
      return tab.left >= area.left-1 && tab.right <= area.right+1 && parent.scrollWidth > parent.clientWidth;
    });
    await until(visible);
    await selected.press('Home'); await list.getByRole('tab', { name: titles.overview, selected: true }).waitFor(); await until(visible);
    await selected.press('ArrowRight'); await list.getByRole('tab', { name: titles.legacy, selected: true }).waitFor();
    await selected.press('Delete'); await list.getByRole('tab', { name: '新标签页', selected: true }).waitFor();
    await list.getByRole('tab', { name: titles.overview }).click();
  });
  await step('宽屏与压缩帧铺满视口，页面边缘点击及录制准确', async () => {
    await page.setViewportSize({ width: 3200, height: 1440 });
    await page.locator('[data-sidebar-right-mode="fullscreen"]').first().click();
    await until(async () => await image.evaluate(node => node.parentElement.clientWidth) > 2560);
    const wide = await geometry();
    assert.ok(wide.encodedW < wide.width);
    evidence.panelLayout.wide = wide;
    evidence.panelLayout.wideCorners = await corners(wide);
    await writeFile(join(out,'panel-layout.json'), JSON.stringify(evidence.panelLayout, null, 2));
  });
}
