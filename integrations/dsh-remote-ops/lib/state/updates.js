import { randomUUID } from "node:crypto";
import { reloadBlockers } from "../hot-reload.js";
import { sessionError } from "../common.js";
import { PLUGIN_VERSION } from "../version.js";
import { UPDATE_PACKAGE, UPDATE_CACHE_MS, compareVersions, normalizeUpdateSettings, readUpdateSettings, writeUpdateSettings, fetchLatestRelease, downloadRelease } from "../release.js";

export async function monitorInstall(state, operation, timeoutMs = 10 * 60 * 1000) {
  const timer = setTimeout(() => {
    if (state.disposed) return;
    state.updatePhase = "install-stalled";
    state.updateError = "安装耗时超出预期，结果尚未确认。请刷新更新状态或查看 DSH 插件管理日志；不会自动重复安装。";
  }, timeoutMs);
  timer.unref?.();
  try { return await operation; } finally { clearTimeout(timer); }
}

// All network checks and installation are explicit user actions. GET reads local state only.
export const withUpdates = (Base) => class UpdatesLayer extends Base {
  updateProgress() {
    return { ...this.release, phase: this.updatePhase ?? "idle", operationId: this.updateOperationId ?? null,
      startedAt: this.updateStartedAt ?? null, busy: Boolean(this.updatePromise || this.releaseCheckPromise || this.updateSettingsWrite || this.reloadGate || ["waiting", "preparing", "reloading"].includes(this.updatePhase)) };
  }
  async loadUpdateSettings() {
    if (!this.updateSettingsPromise) this.updateSettingsPromise = readUpdateSettings(this.base).then(value => this.updateSettings = value).catch(error => { this.updateSettingsPromise = undefined; throw error; });
    return this.updateSettingsPromise;
  }

  async updateStatus() {
    let settings, settingsError;
    try { settings = await this.loadUpdateSettings(); } catch (error) { settings = { source: "github", url: "" }; settingsError = error.message; }
    const bundles = await this.updateManager?.listBundles();
    const installedVersion = bundles?.find(bundle => bundle.name === UPDATE_PACKAGE)?.version ?? PLUGIN_VERSION;
    const needsActivation = installedVersion !== PLUGIN_VERSION;
    const pending = Boolean(this.hotReload?.supported) && (needsActivation && ["waiting", "preparing", "reloading"].includes(this.updatePhase) || ["waiting-install", "preparing-install"].includes(this.updatePhase));
    return { ...this.updateProgress(), settings, currentVersion: PLUGIN_VERSION, installedVersion, needsActivation,
      restartRequired: needsActivation && (!this.hotReload?.supported || this.updatePhase === "restart-required"),
      hotReload: { supported: Boolean(this.hotReload?.supported), pending, blockers: pending ? reloadBlockers(this) : [] },
      phase: this.updatePhase ?? "idle", busy: Boolean(this.updatePromise || this.releaseCheckPromise || this.updateSettingsWrite || this.reloadGate || pending), checkedAt: this.releaseCheckedAt ? new Date(this.releaseCheckedAt).toISOString() : null, canInstall: Boolean(this.updateManager), error: settingsError ?? this.updateError ?? null, requestFailure: settingsError ? null : this.updateFailure ?? null };
  }

  async saveUpdateSettings(value) {
    if (this.updatePromise || this.releaseCheckPromise || this.updateSettingsWrite || ["waiting", "preparing", "reloading"].includes(this.updatePhase)) throw sessionError("UPDATE_BUSY", "更新操作进行中，请稍后修改来源");
    const settings = normalizeUpdateSettings(value);
    this.updateSettingsWrite = true;
    try {
      await this.updateSettingsPromise?.catch(() => {});
      await writeUpdateSettings(this.base, settings);
      this.updateSettings = settings; this.updateSettingsPromise = Promise.resolve(settings);
      this.release = { currentVersion: PLUGIN_VERSION, latestVersion: PLUGIN_VERSION, updateAvailable: false };
      this.releaseCheckedAt = 0; this.updateError = null; this.updateFailure = null; this.updatePhase = "idle";
    } finally { this.updateSettingsWrite = false; }
    return this.updateStatus();
  }

  async checkForUpdate(force = false, installing = false) {
    if (["waiting", "preparing", "reloading"].includes(this.updatePhase)) throw sessionError("UPDATE_BUSY", "已安装版本正在等待应用");
    if (this.updatePromise && !installing) throw sessionError("UPDATE_BUSY", "安装操作进行中，请等待结果");
    if (this.updateSettingsWrite) throw sessionError("UPDATE_BUSY", "正在保存更新设置");
    if (this.releaseCheckPromise) return this.releaseCheckPromise;
    if (!force && Date.now() - this.releaseCheckedAt < UPDATE_CACHE_MS) return this.release;
    this.updatePhase = "checking"; this.updateError = null; this.updateFailure = null;
    this.updateDownloadAbort ??= new AbortController();
    this.releaseCheckPromise = (async () => {
      const settings = await this.loadUpdateSettings();
      const value = await fetchLatestRelease(settings, { signal: this.updateDownloadAbort.signal });
      this.release = value; this.releaseCheckedAt = Date.now(); this.updatePhase = "idle";
      return value;
    })().catch(error => { this.updatePhase = "failed"; this.updateError = error.message; this.updateFailure = error.requestFailure ?? null; throw error; }).finally(() => { this.releaseCheckPromise = undefined; });
    return this.releaseCheckPromise;
  }

  upgrade() {
    if (this.updatePromise) return this.updatePromise;
    this.updateOperationId = randomUUID(); this.updateStartedAt = new Date().toISOString();
    this.updatePromise = this.performUpgrade().then(value => ({ ...value, busy: Boolean(value.hotReload?.pending) })).catch(error => { this.updatePhase = "failed"; this.updateError = error.message; this.updateFailure = error.requestFailure ?? null; throw error; }).finally(() => { this.updatePromise = undefined; });
    return this.updatePromise;
  }

  async performUpgrade() {
    if (this.disposed) throw sessionError("UPDATE_CANCELLED", "插件已关闭");
    const before = await this.updateStatus();
    if (before.needsActivation) {
      if (before.hotReload?.supported && !before.restartRequired) this.hotReload.schedule(before.installedVersion);
      return { ...await this.updateStatus(), updated: false };
    }
    const release = await this.checkForUpdate(true, true);
    if (!release.updateAvailable) return { ...await this.updateStatus(), updated: false };
    if (!this.updateManager) throw sessionError("UPDATE_MANAGER_UNAVAILABLE", "当前 DSH 未提供插件管理服务，请通过 dsh plugin 安装更新");
    const manager = this.updateManager;
    // Package installation remains owned by DSH; activation is a separate idle transaction.
    const bundle = (await manager.listBundles()).find(item => item.name === UPDATE_PACKAGE);
    if (!bundle?.installed) throw sessionError("UPDATE_PROFILE_NOT_FOUND", "当前 profile 未安装 Remote Ops，不能自动修改其他 profile");
    if (compareVersions(bundle.version, release.latestVersion) >= 0) return { ...await this.updateStatus(), updated: false };
    const downloaded = await downloadRelease(release, this.base, { signal: this.updateDownloadAbort.signal, onPhase: phase => this.updatePhase = phase });
    if (this.disposed) throw sessionError("UPDATE_CANCELLED", "插件已关闭，未执行安装");
    await this.hotReload?.prepareInstall?.();
    this.updatePhase = "installing";
    this.updateInstallId = `remote-ops-update-${randomUUID()}`;
    const result = await monitorInstall(this, manager.installBundle(downloaded.path, { requestId: this.updateInstallId }));
    if (this.disposed) throw sessionError("UPDATE_CANCELLED", "插件已关闭，请重新打开插件查看已安装版本");
    if (result.application === "failed" || result.application === "cancelled" || result.packageResult?.exitCode) {
      const reason = result.pendingBuilds?.length ? `依赖构建脚本等待批准：${result.pendingBuilds.join(", ")}。请在 DSH 插件管理中处理后重试。` : result.error?.code ?? result.packageResult?.kind ?? result.application;
      throw sessionError("UPDATE_INSTALL_FAILED", `安装失败：${reason}。详情见 DSH 插件管理日志${result.packageResult?.logPath ? ` ${result.packageResult.logPath}` : ""}`);
    }
    const installed = (await manager.listBundles()).find(item => item.name === UPDATE_PACKAGE);
    if (installed?.version !== release.latestVersion) throw sessionError("UPDATE_INSTALL_UNVERIFIED", "安装返回成功，但磁盘版本不匹配，请检查 DSH 插件管理日志");
    this.updatePhase = "ready"; this.updateError = null; this.updateFailure = null;
    this.hotReload?.schedule(installed.version);
    return { ...await this.updateStatus(), updated: true, sha256: downloaded.sha256 };
  }
};
