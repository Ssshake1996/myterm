// Runs inside every document (including cross-origin frames). It only observes;
// it never cancels an event, changes a value, or decides whether a test passed.
export function installRecordingObserver(binding) {
  const previous = window.__remoteOpsRecordingObserver;
  if (previous?.binding === binding) return;
  if (previous) {
    // A hot update can retain the context and its earlier document listeners.
    void previous.configure(null).catch(() => {});
    if (typeof window.__remoteOpsRecordingEvent === 'function') window.__remoteOpsRecordingEvent = async () => ({ recordingId: null });
  }
  let recordingId = null, pending, timer, lastScroll = 0;
  const deliveries = new Set();
  const clip = value => String(value ?? '').slice(0, 2000);
  const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
  const sensitive = node => node?.matches?.('input[type=password]') || /password|passwd|secret|token|one.?time|otp|密码|口令|验证码/i.test([node?.id, node?.name, node?.getAttribute?.('autocomplete'), node?.getAttribute?.('aria-label')].join(' '));
  const unique = (root, css, node) => {
    const found = root.querySelectorAll(css);
    return found.length === 1 && found[0] === node;
  };
  const selector = node => {
    if (!node?.tagName) return null;
    const root = node.getRootNode();
    if (node.id && unique(root, '#' + CSS.escape(node.id), node)) return '#' + CSS.escape(node.id);
    const parts = [];
    for (let current = node; current?.tagName && parts.length < 8; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current.tagName) : [current];
      parts.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''));
      const parent = current.parentElement;
      if (parent?.id && unique(root, '#' + CSS.escape(parent.id), parent)) { parts.unshift('#' + CSS.escape(parent.id)); break; }
    }
    return parts.join(' > ');
  };
  const inputRoles = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', search: 'searchbox', number: 'spinbutton', email: 'textbox', text: 'textbox', tel: 'textbox', url: 'textbox' };
  const roleOf = node => {
    const explicit = node.getAttribute('role');
    if (explicit) return explicit;
    if (node.matches('input')) return inputRoles[node.type];
    if (node.matches('select')) return node.multiple || node.size > 1 ? 'listbox' : 'combobox';
    if (node.matches('a[href]')) return 'link';
    return { button: 'button', textarea: 'textbox', output: 'status' }[node.localName];
  };
  const describe = node => {
    if (!node?.tagName) return null;
    const root = node.getRootNode(), tag = node.tagName.toLowerCase(), type = node.getAttribute('type');
    const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => root.getElementById(id)?.textContent || '').join(' ').trim();
    const label = normalize(labelledBy || node.getAttribute('aria-label') || node.labels?.[0]?.innerText);
    const placeholder = node.getAttribute('placeholder');
    const role = roleOf(node);
    let name = label;
    if (!name && node.matches('button,a,option,[role=button],[role=link],[role=menuitem],[role=tab]')) name = normalize(node.innerText);
    if (!name && node.matches('input[type=button],input[type=submit],input[type=reset]')) name = normalize(node.value);
    const shadowHosts = []; for (let root = node.getRootNode(); root?.host; root = root.host.getRootNode()) shadowHosts.unshift(selector(root.host));
    const css = selector(node), locators = [];
    const attribute = (key, value) => '[' + key + '="' + CSS.escape(value) + '"]';
    const byCss = (kind, value, query) => locators.push({ kind, value, match: unique(root, query, node) ? 'unique' : 'ambiguous' });
    const testId = node.getAttribute('data-testid');
    if (testId) byCss('testId', testId, attribute('data-testid', testId));
    if (label && node.matches('input,select,textarea,[contenteditable]')) locators.push({ kind: 'label', value: label });
    if (role && (name || ['status', 'alert'].includes(role))) locators.push({ kind: 'role', value: role, ...(name ? { name } : {}) });
    if (placeholder) byCss('placeholder', placeholder, attribute('placeholder', placeholder));
    if (node.name && node.matches('input,select,textarea,button')) {
      const byName = tag + attribute('name', node.name);
      byCss('css', byName, byName);
    }
    byCss('css', css, css);
    return { tag, type, role, name: clip(name || placeholder), label, css, locators, shadowHosts, sensitive: !!sensitive(node) };
  };
  const send = event => {
    if (!recordingId) return;
    const promise = window[binding]({ recordingId, observedAt: new Date().toISOString(), ...event }).catch(() => {}).finally(() => deliveries.delete(promise));
    deliveries.add(promise);
  };
  const flush = () => { clearTimeout(timer); if (pending) { send(pending); pending = null; } };
  // Observe explicit feedback regions, including asynchronous updates after a click.
  const regions = '[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"],output';
  let lastFeedback = new WeakMap();
  const privateInputs = new Map();
  const reportFeedback = changes => {
    if (!recordingId) return;
    const changed = new Set();
    for (const change of changes) {
      const parent = change.target.nodeType === 1 ? change.target : change.target.parentElement;
      const region = parent?.closest(regions);
      if (region) changed.add(region);
      if (change.type === 'attributes' && parent) for (const child of parent.querySelectorAll(regions)) changed.add(child);
      for (const added of change.addedNodes) {
        if (added.nodeType !== 1) continue;
        if (added.matches(regions)) changed.add(added);
        for (const child of added.querySelectorAll(regions)) changed.add(child);
      }
    }
    for (const region of changed) {
      if (!region.isConnected || !region.getClientRects().length || region.closest('[aria-hidden="true"],[aria-live="off"]') || getComputedStyle(region).visibility !== 'visible') {
        lastFeedback.delete(region);
        continue;
      }
      const text = (region.innerText ?? '').trim();
      if (lastFeedback.get(region) === text) continue;
      lastFeedback.set(region, text);
      if (!text) continue;
      const redacted = [...privateInputs.values()].some(value => text.includes(value));
      const target = redacted ? { tag: region.localName, role: roleOf(region) } : describe(region);
      send({ action: 'feedback', target, feedback: redacted ? { redacted: true } : { text: text.slice(0, 500), truncated: text.length > 500 } });
    }
  };
  const feedback = new MutationObserver(reportFeedback);
  const configure = id => {
    if (id === recordingId) return;
    feedback.disconnect(); lastFeedback = new WeakMap(); privateInputs.clear();
    recordingId = id;
    if (id) feedback.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style'] });
  };
  const pointer = (event, node) => {
    const result = { x: event.clientX, y: event.clientY, button: event.button, count: event.detail };
    if (node?.matches('canvas')) {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height) result.relative = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    }
    return result;
  };
  const input = node => ({ action: node.matches('select') ? 'select' : node.matches('input[type=checkbox],input[type=radio]') ? 'check' : 'fill', target: describe(node), ...(sensitive(node) ? { input: { redacted: true, reason: 'sensitive-field' } } : node.matches('input[type=file]') ? { input: { redacted: true, reason: 'file-selection', count: node.files?.length ?? 0 } } : { input: { value: String(node.isContentEditable ? node.innerText : node.value).slice(0, 16000), truncated: String(node.isContentEditable ? node.innerText : node.value).length > 16000, ...(node.matches('input[type=checkbox],input[type=radio]') ? { checked: node.checked } : {}) } }) });
  const nodeOf = event => event.composedPath().find(item => item?.tagName);
  const on = (name, fn) => document.addEventListener(name, event => { if (recordingId && event.isTrusted) fn(event, nodeOf(event)); }, true);
  on('click', (event, node) => { flush(); const target = node?.closest('button,a,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]') || node; send({ action: 'click', target: describe(target), pointer: pointer(event, target) }); });
  on('pointerover', (event, node) => { const target = node?.closest('button,a,[role=button],[role=menuitem],[aria-haspopup]'); if (target && !target.contains(event.relatedTarget)) send({ action: 'hover', target: describe(target) }); });
  on('contextmenu', (event, node) => { flush(); send({ action: 'contextmenu', target: describe(node), pointer: { x: event.clientX, y: event.clientY, button: event.button } }); });
  for (const action of ['dragstart', 'drop']) on(action, (event, node) => { flush(); send({ action, target: describe(node), pointer: { x: event.clientX, y: event.clientY } }); });
  on('input', (_event, node) => { if (!node?.matches('input,textarea,select,[contenteditable]')) return; if (sensitive(node) && node.value) privateInputs.set(node, node.value); if (pending && pending.target?.css !== selector(node)) flush(); pending = input(node); clearTimeout(timer); timer = setTimeout(flush, 150); });
  on('change', (_event, node) => { flush(); if (node?.matches('input,textarea,select,[contenteditable]')) send(input(node)); });
  on('keydown', (event, node) => {
    if (['Control','Meta','Alt','Shift'].includes(event.key)) return;
    if (!['Enter','Tab','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Backspace','Delete'].includes(event.key) && !(event.ctrlKey || event.metaKey || event.altKey)) return;
    flush(); send({ action: 'press', target: describe(node), key: [event.ctrlKey ? 'Control' : '', event.metaKey ? 'Meta' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key].filter(Boolean).join('+') });
  });
  on('scroll', (_event, node) => { if (Date.now() - lastScroll < 250) return; lastScroll = Date.now(); send({ action: 'scroll', target: describe(node), position: { x: node?.scrollLeft ?? scrollX, y: node?.scrollTop ?? scrollY } }); });
  window.addEventListener('pagehide', flush, true);
  let configured = false;
  window.__remoteOpsRecordingObserver = {
    binding,
    async flush() { flush(); reportFeedback(feedback.takeRecords()); await Promise.allSettled([...deliveries]); },
    async configure(id) { configured = true; await this.flush(); configure(id); },
  };
  window[binding]({ action: 'ready' }).then(value => { if (!configured) configure(value?.recordingId ?? null); }).catch(() => {});
}
