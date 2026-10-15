const string = description => ({ type: "string", description });
const nullable = schema => ({ oneOf: [schema, { type: "null" }] });
const optionalString = description => nullable(string(description));
const choice = (values, description) => ({ type: "string", enum: values, description });
const object = (properties, required = []) => ({ type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}) });
const target = object({
  kind: choice(["css", "xpath", "role", "label", "text", "placeholder"], "Locator kind"),
  value: string("Nonblank selector or exact text; for role this is the ARIA role"),
  name: optionalString("Exact accessible name for role; null means unspecified; empty string is an exact empty name"),
  frame: optionalString("CSS iframe selector; omit, null or blank to use the main page"),
}, ["kind", "value"]);
const state = nullable(choice(["visible", "hidden"], "Default visible; hidden is supported for wait/expect"));
const stepFields = {
  target: nullable(target), url: optionalString("HTTP(S) URL for goto"),
  value: optionalString("Fill/press/select value or assert text; empty string is meaningful"),
  secretRef: { type: "null", description: "Only fill may supply the saved site's passwordRef; otherwise omit or null" },
  timeoutMs: nullable({ type: "integer", description: "100–30000 ms, default 10000; null uses the default" }),
  expectPopup: nullable({ type: "boolean", description: "Click opens a new page and selects it" }), state,
  expect: nullable(object({ target, text: optionalString("Result must contain this text"), state }, ["target"])),
};
const step = (actions, required, fields = {}) => object({
  action: choice(actions, "Supported declarative action; use fill for text entry, goto for navigation"),
  ...stepFields, ...fields,
}, ["action", ...required]);
const steps = { type: "array", description: "1–40 action objects; use a real array. Every action except goto needs target, including read. Saved flows may use []", items: { oneOf: [
  step(["goto"], ["url"], { url: string("Complete HTTP(S) URL") }),
  step(["fill"], ["target", "value"], { target, value: string("Text to fill; empty string clears the field") }),
  step(["fill"], ["target", "secretRef"], { target, value: { type: "null" }, secretRef: string("Only the saved site's passwordRef") }),
  step(["press", "select"], ["target", "value"], { target, value: string("Key to press or option value to select") }),
  step(["click", "check", "uncheck", "scroll", "wait", "read", "assert"], ["target"], { target }),
] } };
const browser = { browserId: optionalString("Browser ID from open/list; omit or null for this conversation's selected browser") };
const requestId = string("Stable unique key per intended operation, 1–160 characters; the same request deduplicates for ten minutes in this plugin process");

export const BROWSER_TOOL_SCHEMAS = {
  remote_browser_list: object({}),
  remote_browser_open: object({
    url: optionalString("HTTP(S) URL; no saved site is required"), siteId: optionalString("Saved site ID instead of URL"),
    display: nullable(choice(["embedded", "window"], "Display preference")),
    browser: nullable(choice(["chromium", "msedge", "chrome"], "Browser engine")),
  }),
  remote_browser_login: object({ ...browser, requestId }, ["requestId"]),
  remote_browser_run: object({
    ...browser, requestId,
    flowId: optionalString("Existing flow.id from remote_browser_list with matching siteId. Omit for inline steps; null/blank is absent. Never invent an ID"),
    pageId: optionalString("Optional exact open page ID"),
    variables: nullable({ type: "object", properties: {}, additionalProperties: true, description: "Text values for {{parameter}}; never passwords" }),
    steps: nullable(steps),
  }, ["requestId"]),
  remote_browser_read: object({ ...browser, target: nullable(target) }),
  remote_browser_control: object({
    ...browser, action: choice(["focus", "select-page", "close", "dialog-accept", "dialog-dismiss"], "Browser operation; use native DSH cancellation for task control"),
    pageId: optionalString("Existing page ID, required for select-page"),
  }, ["action"]),
};
