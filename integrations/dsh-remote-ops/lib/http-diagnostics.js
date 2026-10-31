// Shared by the server and the generated browser client. Never include request bodies or headers.
export function safeRequestUrl(address, base = 'http://local.invalid/') {
  try {
    const url = new URL(String(address), base);
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...new Set(url.searchParams.keys())]) url.searchParams.set(key, '[REDACTED]');
    return url.href;
  } catch { return '[无效地址]'; }
}

export function safeDiagnosticText(value, limit = 1200) {
  const sensitive = /password|passwd|secret|token|cookie|authorization|api[-_]?key|credential|signature/i;
  const scrub = text => String(text)
    .replace(/https?:\/\/[^\s<>"']+/gi, address => safeRequestUrl(address))
    .replace(/((?:authorization|proxy-authorization|set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;"'<>]+/gi, '$1 [REDACTED]')
    .replace(/(["']?[\w-]*(?:password|passwd|secret|token|cookie|authorization|api[-_]?key|credential|signature)[\w-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*(?:"|$)|'[^']*(?:'|$)|[^\s,;<>]+)/gi, '$1[REDACTED]');
  const clean = (item, depth = 0) => {
    if (depth > 12) return '[内容省略]';
    if (typeof item === 'string') return scrub(item);
    if (Array.isArray(item)) return item.slice(0, 50).map(child => clean(child, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 80).map(([key, child]) => [key, sensitive.test(key) ? '[REDACTED]' : clean(child, depth + 1)]));
    return item;
  };
  let text = String(value ?? '');
  try { text = JSON.stringify(clean(JSON.parse(text))); } catch { text = scrub(text); }
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export function requestFailure({ url, base, method = 'GET', status = null, stage = 'request', responseSummary = '', cause = '', at } = {}) {
  return { url: safeRequestUrl(url, base), method: String(method).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12) || 'GET', status: Number.isInteger(status) ? status : null, stage, responseSummary: safeDiagnosticText(responseSummary), cause: safeDiagnosticText(cause, 300), at: at ?? new Date().toISOString() };
}

export function requestFailureTitle(failure) {
  if (['update-manifest', 'update-checksum', 'update-package'].includes(failure?.stage)) return '插件更新失败';
  return { 'state-refresh': '状态刷新失败', 'terminal-output': '终端输出刷新失败', 'update-status': '更新状态读取失败', 'update-settings': '更新来源保存失败', 'update-check': '更新检查失败', 'update-install': '插件更新失败' }[failure?.stage] ?? '请求失败';
}

export function formatRequestFailure(value) {
  const failure = requestFailure(value);
  const stages = { 'state-refresh': '读取工作区状态', 'terminal-output': '读取终端输出', 'update-status': '读取本地更新状态', 'update-settings': '保存更新来源', 'update-check': '检查更新', 'update-install': '安装更新', 'update-manifest': '读取版本清单', 'update-checksum': '下载 SHA256 校验文件', 'update-package': '下载安装包' };
  return [requestFailureTitle(failure), `请求：${failure.method} ${failure.url}`, failure.status === null ? '状态：未收到 HTTP 响应' : `状态：HTTP ${failure.status}`, `阶段：${stages[failure.stage] ?? '插件请求'}`, failure.cause && `原因：${failure.cause}`, `响应摘要：${failure.responseSummary || '响应为空'}`, `时间：${failure.at}`].filter(Boolean).join('\n');
}

export function createRefreshNoticeGate(storage) {
  const key = 'remote-ops.refresh-notices';
  let runtime = '', seen = new Set();
  try { const saved = JSON.parse(storage?.getItem(key) ?? 'null'); runtime = typeof saved?.runtime === 'string' ? saved.runtime : ''; seen = new Set(Array.isArray(saved?.seen) ? saved.seen.filter(item => typeof item === 'string').slice(-100) : []); } catch { /* Storage is optional. */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify({ runtime, seen: [...seen].slice(-100) })); } catch { /* Memory still suppresses duplicate notices. */ } };
  return {
    setRuntime(id) { if (!id || id === runtime) return; if (runtime) seen.clear(); runtime = id; save(); },
    shouldNotify(error, manual = false) {
      const failure = error?.requestFailure;
      const signature = failure ? [failure.stage, failure.method, safeRequestUrl(failure.url), failure.status, error.code ?? ''].join('|') : String(error?.message ?? error);
      if (!manual && seen.has(signature)) return false;
      seen.add(signature); if (seen.size > 100) seen.delete(seen.values().next().value); save(); return true;
    },
  };
}

// Only an explicitly started update permits a short reconnect window. Keep
// separate failure clocks so successful state reads cannot hide a broken
// terminal route, and persist the clocks across client hot replacement.
export function createUpdateRecovery(storage, now = () => Date.now(), graceMs = 30000) {
  const key = 'remote-ops.update-recovery';
  let saved = { active: false, seenAt: 0, failures: {} };
  try { const value = JSON.parse(storage?.getItem(key) ?? 'null'); if (typeof value?.active === 'boolean' && Number.isFinite(value.seenAt) && value.failures && typeof value.failures === 'object') saved = value; } catch { /* Optional browser storage. */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify(saved)); } catch { /* Optional browser storage. */ } };
  const active = () => saved.active && now() - saved.seenAt < 15 * 60 * 1000;
  return {
    active,
    begin() { saved = { active: true, seenAt: now(), failures: {} }; save(); },
    observe(value) {
      if (typeof value?.phase !== 'string') return;
      saved.active = Boolean(value.busy) || ['checking', 'downloading', 'verifying', 'waiting-install', 'preparing-install', 'installing', 'install-stalled', 'ready', 'waiting', 'preparing', 'reloading'].includes(value.phase);
      saved.seenAt = now();
      if (!saved.active) saved.failures = {};
      save();
    },
    success(stage) { if (stage in saved.failures) { delete saved.failures[stage]; save(); } },
    recovering(stage) { return active() && Number.isFinite(saved.failures[stage]) && now() - saved.failures[stage] < graceMs; },
    shouldRecover(error) {
      const failure = error?.requestFailure;
      if (!active() || !['state-refresh', 'terminal-output', 'update-status'].includes(failure?.stage) || ![null, 404, 503].includes(failure.status) || error.code && error.code !== 'UPDATE_RELOADING') return false;
      if (!Number.isFinite(saved.failures[failure.stage])) { saved.failures[failure.stage] = now(); save(); }
      return now() - saved.failures[failure.stage] < graceMs;
    },
  };
}
