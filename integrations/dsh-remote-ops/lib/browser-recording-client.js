// Runs inside every document (including cross-origin frames). It only observes;
// it never cancels an event, changes a value, or decides whether a test passed.
export function installRecordingObserver(binding) {
  if (window.__remoteOpsRecordingObserver) return;
  let recordingId = null, pending, timer, lastScroll = 0;
  const deliveries = new Set();
  const clip = value => String(value ?? '').slice(0, 2000);
  const sensitive = node => node?.matches?.('input[type=password]') || /password|passwd|secret|token|one.?time|otp|密码|口令|验证码/i.test([node?.id, node?.name, node?.getAttribute?.('autocomplete'), node?.getAttribute?.('aria-label')].join(' '));
  const selector = node => {
    if (!node?.tagName) return null;
    if (node.id) return '#' + CSS.escape(node.id);
    const parts = [];
    for (let current = node; current?.tagName && parts.length < 8; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current.tagName) : [current];
      parts.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''));
      if (current.parentElement?.id) { parts.unshift('#' + CSS.escape(current.parentElement.id)); break; }
    }
    return parts.join(' > ');
  };
  const describe = node => {
    if (!node?.tagName) return null;
    const tag = node.tagName.toLowerCase(), type = node.getAttribute('type');
    const label = node.labels?.[0]?.innerText;
    const name = node.getAttribute('aria-label') || label || node.getAttribute('placeholder') || (node.matches('button,a,option,[role=button]') ? node.innerText : '');
    const role = node.getAttribute('role') || ({ button: 'button', a: node.hasAttribute('href') ? 'link' : undefined, select: 'combobox', textarea: 'textbox' }[tag]) || (tag === 'input' ? ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button' }[type] || 'textbox') : undefined);
    const shadowHosts = []; for (let root = node.getRootNode(); root?.host; root = root.host.getRootNode()) shadowHosts.unshift(selector(root.host));
    return { tag, type, role, name: clip(name), label: clip(label), css: selector(node), shadowHosts, sensitive: !!sensitive(node) };
  };
  const send = event => {
    if (!recordingId) return;
    const promise = window[binding]({ recordingId, observedAt: new Date().toISOString(), ...event }).catch(() => {}).finally(() => deliveries.delete(promise));
    deliveries.add(promise);
  };
  const flush = () => { clearTimeout(timer); if (pending) { send(pending); pending = null; } };
  const input = node => ({ action: node.matches('select') ? 'select' : node.matches('input[type=checkbox],input[type=radio]') ? 'check' : 'fill', target: describe(node), ...(sensitive(node) ? { input: { redacted: true, reason: 'sensitive-field' } } : node.matches('input[type=file]') ? { input: { redacted: true, reason: 'file-selection', count: node.files?.length ?? 0 } } : { input: { value: String(node.isContentEditable ? node.innerText : node.value).slice(0, 16000), truncated: String(node.isContentEditable ? node.innerText : node.value).length > 16000, ...(node.matches('input[type=checkbox],input[type=radio]') ? { checked: node.checked } : {}) } }) });
  const nodeOf = event => event.composedPath().find(item => item?.tagName);
  const on = (name, fn) => document.addEventListener(name, event => { if (recordingId && event.isTrusted) fn(event, nodeOf(event)); }, true);
  on('click', (event, node) => { flush(); const target = node?.closest('button,a,input,select,textarea,[role=button]') || node; send({ action: 'click', target: describe(target), pointer: { x: event.clientX, y: event.clientY, button: event.button, count: event.detail } }); });
  on('pointerover', (event, node) => { const target = node?.closest('button,a,[role=button],[role=menuitem],[aria-haspopup]'); if (target && !target.contains(event.relatedTarget)) send({ action: 'hover', target: describe(target) }); });
  on('contextmenu', (event, node) => { flush(); send({ action: 'contextmenu', target: describe(node), pointer: { x: event.clientX, y: event.clientY, button: event.button } }); });
  for (const action of ['dragstart', 'drop']) on(action, (event, node) => { flush(); send({ action, target: describe(node), pointer: { x: event.clientX, y: event.clientY } }); });
  on('input', (_event, node) => { if (!node?.matches('input,textarea,select,[contenteditable]')) return; if (pending && pending.target?.css !== selector(node)) flush(); pending = input(node); clearTimeout(timer); timer = setTimeout(flush, 150); });
  on('change', (_event, node) => { flush(); if (node?.matches('input,textarea,select,[contenteditable]')) send(input(node)); });
  on('keydown', (event, node) => {
    if (['Control','Meta','Alt','Shift'].includes(event.key)) return;
    if (!['Enter','Tab','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Backspace','Delete'].includes(event.key) && !(event.ctrlKey || event.metaKey || event.altKey)) return;
    flush(); send({ action: 'press', target: describe(node), key: [event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key].filter(Boolean).join('+') });
  });
  on('scroll', (_event, node) => { if (Date.now() - lastScroll < 250) return; lastScroll = Date.now(); send({ action: 'scroll', target: describe(node), position: { x: node?.scrollLeft ?? scrollX, y: node?.scrollTop ?? scrollY } }); });
  window.addEventListener('pagehide', flush, true);
  window.__remoteOpsRecordingObserver = {
    async flush() { flush(); await Promise.allSettled([...deliveries]); },
    async configure(id) { flush(); await Promise.allSettled([...deliveries]); recordingId = id; },
  };
  window[binding]({ action: 'ready' }).then(value => { recordingId = value?.recordingId ?? null; }).catch(() => {});
}
