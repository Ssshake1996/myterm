export const browserError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
export const browserUrl = value => {
  let url;
  try { url = new URL(String(value)); } catch { throw browserError("BROWSER_URL_INVALID", "Use a complete http:// or https:// URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw browserError("BROWSER_URL_INVALID", "Only HTTP(S) URLs without embedded credentials are supported");
  return url.href;
};
export const displayUrl = value => {
  try { const url = new URL(value); if(url.protocol==='about:'&&url.pathname==='blank')return 'about:blank';if(!['http:','https:'].includes(url.protocol))return '[unsupported URL]';return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}`; } catch { return "about:blank"; }
};
const text = (value, max = 4000) => typeof value === "string" && value.length <= max;
const kinds = new Set(["css", "xpath", "role", "label", "text", "placeholder"]);
const actions = new Set(["goto", "click", "fill", "press", "select", "check", "uncheck", "scroll", "wait", "read", "assert"]);
export function browserTarget(value) {
  if (!value || !kinds.has(value.kind) || !text(value.value) || !value.value.trim()) throw browserError("BROWSER_STEP_INVALID", "A target needs kind (css/xpath/role/label/text/placeholder) and value");
  if (value.frame !== undefined && (!text(value.frame) || !value.frame.trim())) throw browserError("BROWSER_STEP_INVALID", "frame must be a CSS iframe selector");
  if (value.name !== undefined && !text(value.name)) throw browserError("BROWSER_STEP_INVALID", "Target name is too long");
  return { kind: value.kind, value: value.value, ...(value.name !== undefined ? { name: value.name } : {}), ...(value.frame ? { frame: value.frame } : {}) };
}
export function browserSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 40) throw browserError("BROWSER_STEP_INVALID", "A flow needs 1–40 steps");
  return steps.map(step => {
    if (!step || !actions.has(step.action)) throw browserError("BROWSER_STEP_INVALID", "Unsupported action; JavaScript execution is not a flow action");
    const result = { action: step.action };
    if (step.action === "goto") result.url = browserUrl(step.url);
    else result.target = browserTarget(step.target);
    if (step.value !== undefined) {
      if (!text(step.value, 16000)) throw browserError("BROWSER_STEP_INVALID", "Step value must be text up to 16000 characters");
      result.value = step.value;
    }
    if (["fill", "press", "select"].includes(step.action) && step.value === undefined && !step.secretRef) throw browserError("BROWSER_STEP_INVALID", "This action needs a value");
    if (step.secretRef !== undefined) {
      if (step.action !== "fill" || !text(step.secretRef, 160) || step.value !== undefined) throw browserError("BROWSER_STEP_INVALID", "Use a credential reference only for fill, without a literal value");
      result.secretRef = step.secretRef;
    }
    if (step.expect !== undefined) {
      result.expect = { target: browserTarget(step.expect.target) };
      if (step.expect.text !== undefined) {
        if (!text(step.expect.text, 4000)) throw browserError("BROWSER_STEP_INVALID", "Expected text is too long");
        result.expect.text = step.expect.text;
      }
      if (step.expect.state === "hidden") result.expect.state = "hidden";
    }
    if (step.timeoutMs !== undefined) {
      if (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 30000) throw browserError("BROWSER_STEP_INVALID", "timeoutMs must be 100–30000");
      result.timeoutMs = step.timeoutMs;
    }
    if (step.expectPopup === true && step.action === "click") result.expectPopup = true;
    if (step.state === "hidden" && step.action === "wait") result.state = "hidden";
    return result;
  });
}
export function expandBrowserSteps(steps, variables = {}) {
  if (!variables || typeof variables !== "object" || Array.isArray(variables) || Object.keys(variables).length > 50) throw browserError("BROWSER_VARIABLE_INVALID", "Use at most 50 text parameters");
  const expand = value => {
    if (typeof value === "string") return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_all, key) => {
      if (!Object.hasOwn(variables, key) || !text(variables[key], 16000)) throw browserError("BROWSER_VARIABLE_MISSING", `Missing text parameter: ${key}`);
      return variables[key];
    });
    if (Array.isArray(value)) return value.map(expand);
    return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "secretRef" ? item : expand(item)])) : value;
  };
  return browserSteps(expand(steps));
}
export function locateBrowser(page, target) {
  const scope = target.frame ? page.frameLocator(target.frame) : page;
  if (target.kind === "role") return scope.getByRole(target.value, target.name === undefined ? {} : { name: target.name, exact: true });
  if (target.kind === "label") return scope.getByLabel(target.value, { exact: true });
  if (target.kind === "text") return scope.getByText(target.value, { exact: true });
  if (target.kind === "placeholder") return scope.getByPlaceholder(target.value, { exact: true });
  return scope.locator(`${target.kind}=${target.value}`);
}
async function unique(locator) {
  const count = await locator.count();
  if (count !== 1) throw browserError("BROWSER_TARGET_COUNT", `Expected one target, found ${count}. Test or refine the locator`);
}
async function verify(page, check, timeout, job) {
  const locator = locateBrowser(page, check.target);
  const deadline = Date.now() + timeout;
  while (true) {
    if(job?.stop)throw browserError('BROWSER_CANCELLED','DSH conversation was stopped; later steps will not run');
    const count=await locator.count();
    if(count>1)await unique(locator);
    const visible=count===1&&await locator.isVisible();
    if(check.state==='hidden'?!visible:visible) {
      if(check.text===undefined||(await locator.innerText({timeout:Math.max(1,deadline-Date.now())})).includes(check.text))return;
    }
    if(Date.now()>=deadline)throw browserError('BROWSER_EXPECTATION_FAILED','Expected webpage state did not appear');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}
export async function executeBrowserStep(workspace, record, job, step) {
  job.effectStarted = false;
  const page = record.pages.get(job.pageId);
  if (!page || page.isClosed()) throw browserError("BROWSER_PAGE_CLOSED", "The selected page was closed; nothing was replayed");
  const timeout = step.timeoutMs ?? 10000;
  let value;
  if (step.action === "goto") {
    job.effectStarted = true;
    await page.goto(step.url, { waitUntil: "domcontentloaded", timeout });
    value = displayUrl(page.url());
  } else {
    const locator = locateBrowser(page, step.target);
    if (["wait", "assert"].includes(step.action)) {
      await verify(page, { target: step.target, ...(step.state ? { state: step.state } : {}), ...(step.action === "assert" && step.value !== undefined ? { text: step.value } : {}) }, timeout, job);
    } else {
      if (await locator.count() === 0) await locator.waitFor({ state: "attached", timeout });
      await unique(locator);
      if (step.action === "read") {
        const details = await locator.evaluate(node => ({ password: node.matches('input[type="password"]') }));
        if (details.password) throw browserError("BROWSER_SECRET_READ", "Password fields cannot be read");
        value = workspace.redact(record, await locator.innerText({ timeout })).slice(0, 16000);
      } else if (step.action === "scroll") await locator.scrollIntoViewIfNeeded({ timeout });
      else {
        let input = step.value;
        if (step.action === "fill") {
          if (step.secretRef) input = await workspace.secret(record, page, step.secretRef, step.target);
          else if ((await locator.evaluate(node => ({ password: node.matches('input[type="password"]') }))).password) throw browserError("BROWSER_SECRET_REQUIRED", "Use the saved site password reference or log in manually");
        }
        job.effectStarted = true;
        if (step.action === "fill") await locator.fill(input, { timeout });
        if (step.action === "press") await locator.press(input, { timeout });
        if (step.action === "select") await locator.selectOption(input, { timeout });
        if (step.action === "check") await locator.check({ timeout });
        if (step.action === "uncheck") await locator.uncheck({ timeout });
        if (step.action === "click") {
          if (step.expectPopup) {
            const popup = page.waitForEvent("popup", { timeout });
            // Attach a rejection handler before clicking: a failed click must not leave an unhandled popup timeout.
            void popup.catch(() => {});
            await locator.click({ timeout });
            const opened = await popup;
            await opened.waitForLoadState("domcontentloaded", { timeout });
            job.pageId = workspace.attachPage(record, opened);
            record.activePageId = job.pageId;
          } else await locator.click({ timeout });
        }
      }
    }
  }
  if (step.expect) await verify(record.pages.get(job.pageId), step.expect, timeout, job);
  return { action: step.action, status: "done", completion: step.expect || ["assert", "wait"].includes(step.action) ? "checked" : step.action === "read" ? "observed" : "unverified", ...(value !== undefined ? { value } : {}), pageId: job.pageId };
}
