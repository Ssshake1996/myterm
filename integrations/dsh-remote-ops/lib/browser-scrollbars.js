// Keep Chromium's scrollbar geometry and behavior; improve contrast in its painted parts.
// Constructed stylesheets also work on pages with a restrictive style-src policy.
const contexts = new WeakSet();
function colorScrollbars() {
  const key = '__remoteOpsScrollbarSheet';
  const sheet = window[key] ??= new CSSStyleSheet();
  // scrollbar-color would override a site's ::-webkit-scrollbar width (e.g. 8px -> 15px).
  // Paint the native scrollbar parts without setting widths, heights or overflow.
  sheet.replaceSync(`::-webkit-scrollbar, ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner {
    background-color: light-dark(#e2e8f0, #1e293b) !important;
  }
  ::-webkit-scrollbar-thumb {
    background-color: light-dark(#475569, #cbd5e1) !important;
    border-radius: 8px;
  }`);
  if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

export async function installBrowserScrollbars(context) {
  if (!context.addInitScript) return;
  if (!contexts.has(context)) {
    await context.addInitScript(colorScrollbars);
    contexts.add(context);
  }
  // Existing tabs (including hot-updated sessions) get the same colors without a reload.
  await Promise.all(context.pages().flatMap(page => page.frames().map(frame => frame.evaluate(colorScrollbars).catch(() => {}))));
}
