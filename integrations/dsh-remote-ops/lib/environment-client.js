// Shared, local UI state for SSH and API environment management.
export function createEnvironmentManager(React) {
  const { createElement: h, useEffect, useRef, useState } = React;
  const style = `
    .dsh-remote-ops__environmentManager{container-type:inline-size;position:relative;min-width:0;color:var(--ro-text);font-size:13px}
    .dsh-remote-ops__environmentTop{display:flex;align-items:center;gap:8px;margin-bottom:14px}
    .dsh-remote-ops__environmentTop>input{flex:1;width:0;min-width:0}
    .dsh-remote-ops__environmentTop>button{flex:none;white-space:nowrap}
    .dsh-remote-ops__environmentColumns{display:grid;grid-template-columns:132px minmax(0,1fr);gap:18px;min-height:280px}
    .dsh-remote-ops__environmentGroups{display:flex;flex-direction:column;gap:3px;align-self:start}
    .dsh-remote-ops__environmentGroups>button{display:flex;justify-content:space-between;text-align:left;border:0;background:transparent;min-width:0;padding:8px;color:var(--ro-muted)}
    .dsh-remote-ops__environmentGroups>button>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-remote-ops__environmentGroups>button[aria-pressed=true]{background:color-mix(in srgb,var(--ro-accent) 9%,var(--ro-bg));color:var(--ro-accent);font-weight:600}
    .dsh-remote-ops__environmentGroupCount{font-size:11px;font-variant-numeric:tabular-nums;flex:none;margin-left:6px}
    .dsh-remote-ops__environmentList{min-width:0}
    .dsh-remote-ops__environmentListHead{display:flex;align-items:center;gap:6px;min-height:34px;margin-bottom:4px}
    .dsh-remote-ops__environmentListHead>strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    .dsh-remote-ops__environmentManager .dsh-remote-ops__environmentQuiet{border:0;background:transparent;color:var(--ro-muted);padding:5px 7px;font-size:12px;white-space:nowrap}
    .dsh-remote-ops__environmentManager .dsh-remote-ops__environmentRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 10px;align-items:center;padding:12px 4px;border:0;border-bottom:1px solid var(--ro-border);border-radius:0;margin:0;min-width:0;background:transparent}
    .dsh-remote-ops__environmentManager .dsh-remote-ops__environmentRow>div{min-width:0}
    .dsh-remote-ops__environmentRow[data-selected=true]{background:color-mix(in srgb,var(--ro-accent) 6%,var(--ro-bg))}
    .dsh-remote-ops__environmentRow[data-batch=true]{grid-template-columns:22px minmax(0,1fr)}
    .dsh-remote-ops__environmentName{display:flex;align-items:center;gap:6px;min-width:0;font-weight:600;margin-bottom:4px}
    .dsh-remote-ops__environmentName>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .dsh-remote-ops__environmentMeta{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ro-muted);font-size:12px}
    .dsh-remote-ops__environmentActions{display:flex;align-items:center;gap:3px}
    .dsh-remote-ops__environmentActions>button{white-space:nowrap;padding:4px 7px;font-size:12px;min-height:30px}
    .dsh-remote-ops__environmentActions>button:first-child{color:var(--ro-accent);border-color:color-mix(in srgb,var(--ro-accent) 25%,var(--ro-border));background:color-mix(in srgb,var(--ro-accent) 6%,var(--ro-bg))}
    .dsh-remote-ops__environmentRow>details{grid-column:1/-1;margin:0}
    .dsh-remote-ops__environmentRow>details>summary{padding:2px 0;color:var(--ro-muted);font-size:12px;cursor:pointer}
    .dsh-remote-ops__environmentMobileGroup{display:none;align-items:center;gap:6px;margin-bottom:10px}
    .dsh-remote-ops__environmentMobileGroup>select{flex:1;min-width:0}
    .dsh-remote-ops__environmentBatch{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--ro-border)}
    .dsh-remote-ops__environmentBatch>label{display:flex!important;flex-direction:row!important;align-items:center;gap:6px;margin-right:auto}
    .dsh-remote-ops__environmentManager input[type=checkbox]{width:16px;height:16px;min-height:0;flex:none;accent-color:var(--ro-accent)}
    .dsh-remote-ops__environmentMenu{position:absolute;z-index:12;min-width:170px;max-width:calc(100% - 16px);padding:5px;background:var(--ro-bg);border:1px solid var(--ro-border);border-radius:8px;box-shadow:0 8px 28px #0002;display:flex;flex-direction:column;gap:2px}
    .dsh-remote-ops__environmentMenu>button{text-align:left;justify-content:flex-start;padding:8px 10px;border:0;background:transparent;font-size:13px}
    .dsh-remote-ops__environmentMenu>button:hover:not(:disabled){background:var(--ro-soft)}
    .dsh-remote-ops__environmentMenu>small{color:var(--ro-muted);padding:4px 10px;max-width:190px;font-size:12px}
    .dsh-remote-ops__environmentNotice{padding:8px 0;font-size:12px;overflow-wrap:anywhere}
    .dsh-remote-ops__environmentEmpty{padding:28px 8px;color:var(--ro-muted);text-align:center}
    @container(max-width:560px){.dsh-remote-ops__environmentColumns{grid-template-columns:minmax(0,1fr)}.dsh-remote-ops__environmentGroups{display:none}.dsh-remote-ops__environmentMobileGroup{display:flex}.dsh-remote-ops__environmentManager .dsh-remote-ops__environmentRow{grid-template-columns:minmax(0,1fr)}.dsh-remote-ops__environmentActions{justify-content:flex-end}.dsh-remote-ops__environmentRow[data-batch=true]{grid-template-columns:22px minmax(0,1fr)}}
    @media(pointer:coarse){.dsh-remote-ops__environmentManager button{min-height:40px}.dsh-remote-ops__environmentManager input,.dsh-remote-ops__environmentManager select{font-size:16px}}
  `;
  return function EnvironmentManager({ kind, environments, groups, search, onSearch, group, onGroup, busy, hidden, ask, onCreate, onCreateGroup, onRenameGroup, onDeleteGroup, onEdit, onPrimary, primaryLabel, primaryDisabled, onTest, extraActions, onDelete, describe, renderDetails }) {
    const [batch, setBatch] = useState(false), [selected, setSelected] = useState([]), [pending, setPending] = useState(false);
    const [menu, setMenu] = useState(null), [notice, setNotice] = useState('');
    const root = useRef(null), trigger = useRef(null), alive = useRef(true), deleting = useRef(false);
    const title = kind === 'ssh' ? 'SSH' : 'API', locked = busy || pending;
    const matches = environments.filter(env => (!group || env.group === group) && (!search || [env.name, env.group, describe(env)].join(' ').toLowerCase().includes(search.toLowerCase())));
    const visibleKeys = matches.map(env => env.id).join('\n');
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => { setMenu(null); setSelected([]); if (hidden) setBatch(false); }, [search, group, hidden]);
    useEffect(() => { setSelected(ids => { const next = ids.filter(id => matches.some(env => env.id === id)); return next.length === ids.length ? ids : next; }); }, [visibleKeys]);
    useEffect(() => { if (group && !groups.includes(group)) onGroup(''); }, [group, groups.join('\n')]);
    const dismiss = (focus = false) => { setMenu(null); if (focus) trigger.current?.focus(); };
    useEffect(() => {
      if (!menu) return;
      const popup = root.current?.querySelector('.dsh-remote-ops__environmentMenu');
      popup?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
      const outside = event => { if (!popup?.contains(event.target) && !trigger.current?.contains(event.target)) dismiss(); };
      const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); } };
      const moved = event => { if (!popup?.contains(event.target)) dismiss(); };
      document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', key);
      window.addEventListener('resize', moved); window.addEventListener('scroll', moved, true);
      return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', moved); window.removeEventListener('scroll', moved, true); };
    }, [menu]);
    const showMenu = (event, key, entries, hint) => {
      if (menu?.key === key) { dismiss(); return; }
      trigger.current = event.currentTarget;
      const rect = event.currentTarget.getBoundingClientRect(), box = root.current.getBoundingClientRect();
      const height = entries.length * 38 + (hint ? 48 : 12);
      setMenu({ key, entries, hint, left: Math.max(4, Math.min(rect.right - box.left - 190, box.width - 198)), top: Math.max(0, Math.min(rect.bottom - box.top + 4, Math.min(box.bottom, window.innerHeight - 8) - box.top - height)) });
    };
    const remove = async items => {
      if (!items.length || deleting.current || locked) return;
      deleting.current = true;
      try {
        const impact = kind === 'ssh' ? '删除保存配置，并关闭该环境的现有 SSH 连接。远程设备与已保留日志不删除。' : '删除配置与登录会话，保留执行记录。正在执行请求的环境会保留并报告原因。';
        if (!await ask(`删除${items.length === 1 ? '环境“' + items[0].name + '”' : '所选 ' + items.length + ' 个环境'}？\n${items.map(env => env.name + ' · ' + describe(env)).join('\n')}\n${impact}`) || !alive.current) return;
        setPending(true); setNotice(''); const failed = []; let removed = 0;
        for (const item of items) {
          if (!alive.current) break;
          try { if (await onDelete(item)) removed++; else failed.push({ ...item, error: '未收到删除完成确认' }); }
          catch (error) { failed.push({ ...item, error: String(error?.message ?? error).slice(0, 600) }); }
        }
        if (alive.current) { setSelected(failed.map(item => item.id)); setNotice(`已删除 ${removed} 个环境${failed.length ? '；未确认：' + failed.map(item => item.name + '（' + item.error + '）').join('、') + '。请刷新核对后重试。' : ''}`); }
      } finally { deleting.current = false; if (alive.current) setPending(false); }
    };
    const createGroup = onCreateGroup ? h('button', { type: 'button', className: 'dsh-remote-ops__environmentQuiet', disabled: locked, onClick: onCreateGroup }, '+ 分组') : null;
    const groupEntries = group && onRenameGroup ? [
      { label: '重命名分组', run: () => onRenameGroup(group) },
      { label: '删除空分组', danger: true, disabled: environments.some(env => env.group === group), run: async () => { if (await ask(`删除空分组“${group}”？`)) await onDeleteGroup(group); } },
    ] : [];
    const selectGroup = value => { onGroup(value); setNotice(''); };
    return h('section', { className: 'dsh-remote-ops__environmentManager', 'aria-label': title + ' 环境管理列表', ref: root, hidden },
      h('style', null, style),
      h('div', { className: 'dsh-remote-ops__environmentTop' }, h('input', { type: 'search', 'aria-label': '搜索 ' + title + ' 环境', placeholder: '搜索名称、分组或地址', value: search, disabled: pending, onChange: e => onSearch(e.target.value) }), h('button', { type: 'button', className: 'dsh-remote-ops__primaryAction', disabled: locked, onClick: () => onCreate(group) }, kind === 'ssh' ? '+ 环境' : '新建 API 环境')),
      h('div', { className: 'dsh-remote-ops__environmentMobileGroup' }, h('select', { 'aria-label': title + ' 环境分组', value: group, disabled: locked, onChange: e => selectGroup(e.target.value) }, h('option', { value: '' }, '全部分组'), groups.map(name => h('option', { key: name, value: name }, name))), createGroup),
      h('div', { className: 'dsh-remote-ops__environmentColumns' },
        h('nav', { className: 'dsh-remote-ops__environmentGroups', 'aria-label': title + ' 分组' }, ['', ...groups].map(name => h('button', { type: 'button', key: name, 'aria-label': '筛选分组 ' + (name || '全部分组'), 'aria-pressed': group === name, disabled: locked, onClick: () => selectGroup(name) }, h('span', null, name || '全部分组'), h('span', { className: 'dsh-remote-ops__environmentGroupCount', 'aria-hidden': true }, environments.filter(env => !name || env.group === name).length))), createGroup),
        h('div', { className: 'dsh-remote-ops__environmentList' },
          h('div', { className: 'dsh-remote-ops__environmentListHead' }, h('strong', null, group || '全部环境'), groupEntries.length ? h('button', { type: 'button', className: 'dsh-remote-ops__environmentQuiet', 'aria-label': '分组操作 ' + group, 'aria-expanded': menu?.key === 'group', disabled: locked, onClick: e => showMenu(e, 'group', groupEntries, environments.some(env => env.group === group) ? '分组内仍有环境，仅空分组可删除。' : '') }, '⋯') : null, h('button', { type: 'button', className: 'dsh-remote-ops__environmentQuiet', disabled: locked, onClick: () => { setBatch(!batch); setSelected([]); setNotice(''); dismiss(); } }, batch ? '完成' : '批量管理')),
          batch ? h('div', { className: 'dsh-remote-ops__environmentBatch' }, h('label', null, h('input', { type: 'checkbox', 'aria-label': '选择当前结果', disabled: locked || !matches.length, checked: !!matches.length && matches.every(env => selected.includes(env.id)), onChange: e => setSelected(e.target.checked ? matches.map(env => env.id) : []) }), '已选 ' + selected.length), h('button', { type: 'button', className: 'dsh-remote-ops__dangerAction', disabled: locked || !selected.length, onClick: () => void remove(matches.filter(env => selected.includes(env.id))) }, pending ? '删除中…' : `删除所选（${selected.length}）`)) : null,
          matches.map(env => h('article', { key: env.id, className: (kind === 'ssh' ? 'dsh-remote-ops__env' : 'ro-api__environment') + ' dsh-remote-ops__environmentRow', 'data-environment-row': env.id, 'data-batch': batch, 'data-selected': selected.includes(env.id) },
            batch ? h('input', { type: 'checkbox', 'aria-label': '选择环境 ' + env.name, checked: selected.includes(env.id), disabled: locked, onChange: e => setSelected(ids => e.target.checked ? [...ids, env.id] : ids.filter(id => id !== env.id)) }) : null,
            h('div', null, h('div', { className: 'dsh-remote-ops__envName dsh-remote-ops__environmentName', title: env.name }, kind === 'ssh' ? h('span', { className: 'dsh-remote-ops__dot', 'data-connected': !!env.connectionCount, 'aria-hidden': true }) : null, h('span', null, env.name)), h('small', { className: 'dsh-remote-ops__environmentMeta', title: describe(env) }, describe(env))),
            !batch ? h('div', { className: 'dsh-remote-ops__environmentActions' },
              h('button', { type: 'button', disabled: locked || primaryDisabled?.(env), onClick: () => onPrimary(env) }, primaryLabel),
              h('button', { type: 'button', className: 'dsh-remote-ops__environmentQuiet', disabled: locked, onClick: () => onEdit(env) }, '编辑'),
              onTest ? h('button', { type: 'button', className: 'dsh-remote-ops__environmentQuiet', 'aria-label': '测试 ' + env.name + ' 连接', disabled: locked, onClick: () => onTest(env) }, '测试') : null,
              h('button', { type: 'button', className: 'dsh-remote-ops__environmentQuiet', 'aria-label': '更多环境操作 ' + env.name, 'aria-expanded': menu?.key === env.id, disabled: locked, onClick: e => showMenu(e, env.id, [...(extraActions?.(env) ?? []), { label: '删除环境', danger: true, run: () => void remove([env]) }]) }, '⋯')) : null,
            !batch && renderDetails ? renderDetails(env) : null)),
          !matches.length ? h('div', { className: 'dsh-remote-ops__environmentEmpty' }, search ? '没有匹配的环境' : '此分组还没有环境，可点击上方新增。') : null,
          notice ? h('div', { className: 'dsh-remote-ops__environmentNotice', role: 'status' }, notice) : null)),
      menu ? h('div', { className: 'dsh-remote-ops__environmentMenu', role: 'group', 'aria-label': '环境管理操作', style: { left: menu.left, top: menu.top } }, menu.entries.map(item => h('button', { type: 'button', key: item.label, className: item.danger ? 'dsh-remote-ops__dangerAction' : undefined, disabled: locked || item.disabled, onClick: () => { dismiss(true); void item.run(); } }, item.label)), menu.hint ? h('small', null, menu.hint) : null) : null);
  };
}
