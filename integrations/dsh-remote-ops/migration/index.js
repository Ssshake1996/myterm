// This entry exists only in the small package installed by the legacy updater.
export * from "./workspace.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { mountRemoteOps } from "./workspace.js";
import { PLUGIN_VERSION } from "./version.js";

// Usually the candidate is preloaded before DSH enters exclusive activation.
const outsideActivation = AsyncLocalStorage.snapshot();

export function apply(ctx) {
  const state = mountRemoteOps(ctx);
  ctx.inject(["pluginManager", "loader", "hmr"], ready => ready.effect(() => {
    let stopped = false, timer, retries = 0;
    const later = ms => { timer = setTimeout(run, ms); timer.unref?.(); };
    async function run() {
      if (stopped || state.disposed || state.release.currentVersion !== PLUGIN_VERSION) return;
      // An existing install may be handing this same live state to the bridge.
      if (state.updatePromise || state.releaseCheckPromise || state.reloadGate || !state.hotReload ||
          state.hotReload.timer || state.hotReload.running) {
        later(350);
        return;
      }
      try {
        await state.upgrade();
      } catch (error) {
        // The regular update page retains the failure and supports a manual retry.
        if (!stopped && ["UPDATE_DOWNLOAD_FAILED", "UPDATE_CHECK_TIMEOUT"].includes(error.code) && retries < 3) {
          later(1000 * 2 ** retries++);
        }
      } finally {
        // The full package can inherit this same state through hot reload.
        state.updateSettingsPromise = undefined;
      }
    }
    outsideActivation(() => {
      // Desktop can import a bridge while reconciling the installed package.
      // Its inherited marker survives even after that activation has finished.
      // Create the timer outside it. The second stage still uses runExclusive's
      // normal queue and checks the workspace gate before starting anything.
      const transaction = ready.hmr.executing;
      if (transaction instanceof AsyncLocalStorage && transaction.getStore()) transaction.exit(() => later(350));
      else later(350);
    });
    return () => { stopped = true; clearTimeout(timer); };
  }, "continue Remote Ops migration"));
}
