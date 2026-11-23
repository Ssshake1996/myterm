// Locator previews are visual hints, never input ownership or a page-wide tint.
// Serialize show/hide so an old timeout cannot erase a newer preview.
export const TARGET_HIGHLIGHT_MS = 1500;
const enqueue = (record, work) => {
  const pending = (record.highlightQueue ?? Promise.resolve()).then(work);
  record.highlightQueue = pending.catch(() => {});
  return pending;
};
async function hide(record) {
  const hint = record.targetHighlight;
  record.targetHighlight = undefined;
  if (!hint) return;
  clearTimeout(hint.timer);
  // Only remove the locator preview we own, not the website's own DOM/styles.
  await hint.locator.hideHighlight().catch(() => {});
}
export function clearTargetHighlight(record, expected) {
  return enqueue(record, () => !expected || record.targetHighlight === expected ? hide(record) : undefined);
}
export function showTargetHighlight(record, page, locator, signal) {
  return enqueue(record, async () => {
    await hide(record);
    if (record.closed || page.isClosed() || signal?.aborted) return;
    const hint = { page, locator };
    record.targetHighlight = hint;
    try {
      await locator.highlight({style:{backgroundColor:'transparent',outline:'2px solid #2563eb',pointerEvents:'none'}});
      if (record.closed || page.isClosed() || signal?.aborted) { await hide(record); return; }
      hint.timer = setTimeout(() => { void clearTargetHighlight(record, hint); }, TARGET_HIGHLIGHT_MS);
      hint.timer.unref?.();
    } catch { await hide(record); } // A lost visual hint must not fail a locator check.
  });
}
