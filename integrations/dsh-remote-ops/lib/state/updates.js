import { sessionError } from "../common.js";
import { UPDATE_CACHE_MS, fetchLatestRelease, findProfileRoot, runPnpm } from "../release.js";

// Checking GitHub Releases for a newer plugin version and installing it.
export const withUpdates = (Base) => class UpdatesLayer extends Base {
  async checkForUpdate(force = false) {
    if (!force && Date.now() - this.releaseCheckedAt < UPDATE_CACHE_MS) return this.release;
    if (this.releaseCheckPromise) return this.releaseCheckPromise;
    this.releaseCheckPromise = fetchLatestRelease().then((value) => { this.release = value; this.releaseCheckedAt = Date.now(); return value; }).finally(() => { this.releaseCheckPromise = undefined; });
    return this.releaseCheckPromise;
  }

  async upgrade() {
    const release = await this.checkForUpdate(true);
    if (!release.updateAvailable) return { ...release, updated: false, restartRequired: false };
    const profileRoot = await findProfileRoot();
    const result = await runPnpm(profileRoot, ["add", release.assetUrl, "--save-prod"]);
    if (result.code !== 0) throw sessionError("UPDATE_INSTALL_FAILED", `pnpm add ${release.assetName} exited with code ${result.code}`, result.stderr || result.stdout);
    this.release = { ...release, updated: true, restartRequired: true, profileRoot: "active DSH profile" };
    return { ...this.release, command: `pnpm add ${release.assetName} --save-prod`, output: result.stdout || result.stderr };
  }
};
