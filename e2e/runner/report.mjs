const REDACT = [/e2e-device-pass/g, /token=[A-Za-z0-9._~-]+/g];

export function redact(value) {
  return REDACT.reduce((text, pattern) => text.replace(pattern, "[redacted]"), String(value ?? ""));
}

export function summarize(results) {
  const failed = results.filter((result) => result.status === "failed");
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 };
}

export function renderMarkdown(report) {
  const counts = summarize(report.results);
  const lines = [
    `# Remote Ops 浏览器执行报告`,
    ``,
    `- 结果：${counts.ok ? "通过" : "失败"}（${counts.passed}/${counts.total}）`,
    `- 插件：${report.pluginVersion}（${report.commit ?? "未知提交"}）`,
    `- 浏览器：${report.browser}`,
    `- 视口层：${report.layer}`,
    `- 开始：${report.startedAt}`,
    `- 耗时：${report.durationMs} ms`,
    ``,
  ];
  const ordered = [...report.results].sort((left, right) => Number(right.status === "failed") - Number(left.status === "failed"));
  for (const result of ordered) {
    lines.push(`## ${result.status === "failed" ? "失败" : "通过"} · ${result.title}`, ``);
    if (result.error) lines.push("```", redact(result.error), "```", ``);
    for (const step of result.steps) lines.push(`- ${step.status === "failed" ? "✗" : "✓"} ${step.name}（${step.durationMs} ms）`);
    if (result.shots.length) lines.push(``, ...result.shots.map((shot) => `- 截图 ${shot.name}：${shot.file}`));
    if (result.problems.length) lines.push(``, ...result.problems.map((problem) => `- ${problem.kind}：${redact(problem.text)}`));
    lines.push(``);
  }
  return `${lines.join("\n")}\n`;
}

function escapeHtml(value) {
  return redact(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function renderHtml(report) {
  const counts = summarize(report.results);
  const scenarios = report.results.map((result) => {
    const steps = result.steps.map((step) => `<li class="${step.status}">${escapeHtml(step.name)} <small>${step.durationMs} ms</small></li>`).join("");
    const shots = result.shots.map((shot) => `<figure><figcaption>${escapeHtml(shot.name)}</figcaption><img alt="${escapeHtml(shot.name)}" src="${shot.dataUrl}"></figure>`).join("");
    const problems = result.problems.map((problem) => `<li>${escapeHtml(problem.kind)}：${escapeHtml(problem.text)}</li>`).join("");
    return `<article class="${result.status}"><h2>${result.status === "failed" ? "失败" : "通过"} · ${escapeHtml(result.title)}</h2>${result.error ? `<pre>${escapeHtml(result.error)}</pre>` : ""}<ol>${steps}</ol>${problems ? `<ul>${problems}</ul>` : ""}${shots}</article>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Remote Ops 执行报告</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#182230}article{border:1px solid #d8dce5;border-radius:10px;padding:12px 16px;margin:12px 0}article.failed{border-color:#d92d20}figure{margin:8px 0}img{max-width:100%;border:1px solid #e5e7eb}pre{white-space:pre-wrap;background:#fff4f2;padding:8px}small{color:#667085}</style></head><body><h1>Remote Ops 浏览器执行报告</h1><p>${counts.ok ? "通过" : "失败"} ${counts.passed}/${counts.total} · ${escapeHtml(report.pluginVersion)} · ${escapeHtml(report.browser)} · ${escapeHtml(report.layer)}</p>${scenarios}</body></html>\n`;
}

export function renderJUnit(report) {
  const counts = summarize(report.results);
  const cases = report.results.map((result) => {
    const failure = result.status === "failed" ? `<failure message="${escapeHtml(result.error ?? "failed")}"><![CDATA[${redact(result.error ?? "")}]]></failure>` : "";
    return `<testcase classname="remote-ops.e2e" name="${escapeHtml(result.title)}" time="${(result.durationMs / 1000).toFixed(3)}">${failure}</testcase>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="remote-ops-e2e" tests="${counts.total}" failures="${counts.failed}">${cases}</testsuite>\n`;
}
