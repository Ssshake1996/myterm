import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentManager } from '../lib/environment-client.js';

const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function mount(overrides = {}) {
  let index = 0, tree;
  const hooks = [], effects = [], hook = () => hooks[index++] ??= {};
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const slot = hook(); if (!('value' in slot)) slot.value = initial; return [slot.value, value => { slot.value = typeof value === 'function' ? value(slot.value) : value; }]; },
    useRef(initial) { const slot = hook(); return slot.value ??= { current: initial }; },
    useEffect(effect, deps) { const slot = hook(); if (!slot.deps || deps.some((value, i) => value !== slot.deps[i])) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); }); } },
  };
  const props = { kind: 'ssh', environments: [{ id: 'a', name: 'Same name', group: 'one' }, { id: 'b', name: 'Same name', group: 'two' }], groups: ['one', 'two'], search: '', group: '', onGroup() {}, onSearch() {}, describe: env => env.group, ask: async () => true, onDelete: async () => true, ...overrides };
  const Manager = createEnvironmentManager(React);
  const render = () => { index = 0; tree = Manager(props); effects.splice(0).forEach(run => run()); return tree; };
  const nodes = () => { const list = []; const visit = node => { if (node && typeof node === 'object') { list.push(node); node.children?.forEach(visit); } }; visit(tree); return list; };
  const button = label => nodes().find(node => node.type === 'button' && node.children.includes(label));
  const field = label => nodes().find(node => node.props['aria-label'] === label);
  const selectAll = () => { button('批量管理').props.onClick(); render(); field('选择当前结果').props.onChange({ target: { checked: true } }); render(); };
  render();
  return { props, render, nodes, button, field, selectAll, unmount: () => hooks.forEach(slot => slot.cleanup?.()) };
}

test('batch deletion freezes IDs before confirmation, deduplicates clicks and excludes new environments', async () => {
  const confirmation = deferred(), calls = []; let questions = 0;
  const view = mount({ ask: () => { questions++; return confirmation.promise; }, onDelete: async env => { calls.push(env.id); return true; } });
  view.selectAll(); const click = view.button('删除所选（2）').props.onClick;
  click(); click(); assert.equal(questions, 1); assert.deepEqual(calls, []);
  view.props.environments = [...view.props.environments, { id: 'later', name: 'Later', group: 'one' }]; view.render();
  confirmation.resolve(true); await tick();
  assert.deepEqual(calls, ['a', 'b']); view.unmount();
});

test('cancelled or unmounted confirmations never delete an environment', async () => {
  for (const unmount of [false, true]) {
    const confirmation = deferred(), calls = [];
    const view = mount({ ask: () => confirmation.promise, onDelete: async env => { calls.push(env.id); return true; } });
    view.selectAll(); view.button('删除所选（2）').props.onClick();
    if (unmount) view.unmount(); confirmation.resolve(unmount); await tick();
    assert.deepEqual(calls, []);
  }
});

test('partial deletion reports its error and retains the failed exact ID even when names match', async () => {
  const view = mount({ onDelete: async env => { if (env.id === 'b') throw Error('request still running'); return true; } });
  view.selectAll(); view.button('删除所选（2）').props.onClick(); await tick(); view.render();
  const selected = view.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'] === '选择环境 Same name');
  assert.deepEqual(selected.map(node => node.props.checked), [false, true]);
  const notice = view.nodes().find(node => node.props.role === 'status');
  assert.match(notice.children.join(''), /已删除 1 个环境/);
  assert.match(notice.children.join(''), /request still running/);
  view.unmount();
});
