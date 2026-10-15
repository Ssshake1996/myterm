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
const stepInvalid = (path, message) => browserError("BROWSER_STEP_INVALID", `${path}: ${message}. Nothing was dispatched`);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
function decodeJson(value, path, max) {
  if (!text(value, max)) throw stepInvalid(path, "Encoded JSON exceeds the supported size");
  try { return JSON.parse(value); } catch { throw stepInvalid(path, "Use valid JSON, or supply the array/object directly"); }
}
function stepsInput(value) {
  if (typeof value === "string") value = decodeJson(value, "steps", 1048576);
  if (record(value)) {
    if (Object.hasOwn(value, "action")) return [value];
    if (Object.keys(value).length === 1 && Array.isArray(value.steps)) return value.steps;
  }
  if (!Array.isArray(value)) throw stepInvalid("steps", "Provide an action array, a single action object, or {steps: [...]} (JSON strings are accepted)");
  return value;
}
function fields(value, allowed, path) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw stepInvalid(path, "Contains unsupported fields; use the published tool Schema");
}
export function browserRunSource({ flowId, steps }) {
  if (flowId != null && typeof flowId !== "string") throw browserError("BROWSER_FLOW_ID_INVALID", "flowId must be a saved flow.id from remote_browser_list; omit it for inline steps. Nothing was dispatched");
  if (steps != null) steps = stepsInput(steps);
  const id = flowId?.trim(), hasSteps = Array.isArray(steps) && steps.length > 0;
  if (id && hasSteps) throw browserError("BROWSER_RUN_SOURCE_CONFLICT", "Provide either a nonblank flowId or inline steps, not both. Omit flowId for ordinary webpage actions. Nothing was dispatched");
  if (id) return id;
  if (hasSteps) return steps;
  throw browserError("BROWSER_RUN_SOURCE_REQUIRED", "Provide 1–40 inline steps, or a saved flow.id from remote_browser_list. Blank flowId and empty steps do not specify an operation. Nothing was dispatched");
}
export function browserTarget(value, path = "target") {
  if (typeof value === "string") {
    const selector = value.trim();
    if (selector.startsWith("{")) value = decodeJson(selector, path, 32768);
    else {
      if (!text(selector) || !selector) throw stepInvalid(path, "Provide nonblank CSS/XPath text up to 4000 characters");
      const prefix = /^(css|xpath)=/.exec(selector);
      if (/^(role|label|text|placeholder)=/.test(selector)) throw stepInvalid(path, "Use {kind, value, name?} for accessible locators; selector strings support CSS/XPath");
      value = { kind: prefix?.[1] ?? (/^(?:\(*\.?\/)/.test(selector) ? "xpath" : "css"), value: prefix ? selector.slice(prefix[0].length) : selector };
    }
  }
  if (!record(value)) throw stepInvalid(path, 'Missing/invalid target. Call remote_browser_read without target to inspect the page, then supply {kind:"css",value:"#id"}, {kind:"xpath",value:"//..."}, or a CSS/XPath selector string from that page; never infer a click target from requestId');
  fields(value, ["kind", "value", "name", "frame"], path);
  if (!kinds.has(value.kind)) throw stepInvalid(`${path}.kind`, "Use css/xpath/role/label/text/placeholder");
  if (!text(value.value) || !value.value.trim()) throw stepInvalid(`${path}.value`, "Provide nonblank locator text up to 4000 characters");
  if (value.frame != null && !text(value.frame)) throw stepInvalid(`${path}.frame`, "Use a CSS iframe selector or omit/null/blank for the main page");
  if (value.name != null && !text(value.name)) throw stepInvalid(`${path}.name`, "Use exact accessible text up to 4000 characters, or omit/null");
  return { kind: value.kind, value: value.value, ...(value.name != null ? { name: value.name } : {}), ...(value.frame?.trim() ? { frame: value.frame } : {}) };
}
export function browserSteps(steps) {
  steps = stepsInput(steps);
  if (!Array.isArray(steps) || !steps.length || steps.length > 40) throw stepInvalid("steps", "Provide an array of 1–40 action objects");
  return steps.map((step, index) => {
    const path = `steps[${index}]`;
    if (!record(step)) throw stepInvalid(path, "Provide an action object");
    fields(step, ["action", "target", "url", "value", "secretRef", "timeoutMs", "expectPopup", "state", "expect"], path);
    if (!actions.has(step.action)) throw stepInvalid(`${path}.action`, "Use goto/click/fill/press/select/check/uncheck/scroll/wait/read/assert; JavaScript is not supported");
    const result = { action: step.action };
    if (step.action === "goto") {
      try { result.url = browserUrl(step.url); } catch (error) { error.message = `${path}.url: ${error.message}. Nothing was dispatched`; throw error; }
    } else result.target = browserTarget(step.target, `${path}.target`);
    if (step.value != null) {
      if (!text(step.value, 16000)) throw stepInvalid(`${path}.value`, "Use text up to 16000 characters");
      result.value = step.value;
    }
    if (step.secretRef != null) {
      if (step.action !== "fill" || !text(step.secretRef, 160) || !step.secretRef.trim() || result.value !== undefined) throw stepInvalid(`${path}.secretRef`, "Use a nonblank saved credential reference only for fill, without a literal value");
      result.secretRef = step.secretRef;
    }
    if (["fill", "press", "select"].includes(step.action) && result.value === undefined && !result.secretRef) throw stepInvalid(`${path}.value`, "This action needs text; fill may instead use the site's secretRef");
    if (step.expect != null) {
      if (!record(step.expect)) throw stepInvalid(`${path}.expect`, "Provide an expectation object or omit/null");
      fields(step.expect, ["target", "text", "state"], `${path}.expect`);
      result.expect = { target: browserTarget(step.expect.target, `${path}.expect.target`) };
      if (step.expect.text != null) {
        if (!text(step.expect.text, 4000)) throw stepInvalid(`${path}.expect.text`, "Use text up to 4000 characters");
        result.expect.text = step.expect.text;
      }
      if (step.expect.state != null && !["visible", "hidden"].includes(step.expect.state)) throw stepInvalid(`${path}.expect.state`, "Use visible/hidden or omit/null");
      if (step.expect.state === "hidden") result.expect.state = "hidden";
    }
    if (step.timeoutMs != null) {
      if (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 30000) throw stepInvalid(`${path}.timeoutMs`, "Use an integer from 100 to 30000 or omit/null");
      result.timeoutMs = step.timeoutMs;
    }
    if (step.expectPopup != null && typeof step.expectPopup !== "boolean") throw stepInvalid(`${path}.expectPopup`, "Use a boolean or omit/null");
    if (step.expectPopup === true && step.action === "click") result.expectPopup = true;
    if (step.state != null && !["visible", "hidden"].includes(step.state)) throw stepInvalid(`${path}.state`, "Use visible/hidden or omit/null");
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
