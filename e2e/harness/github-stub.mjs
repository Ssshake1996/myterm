// The plugin checks GitHub Releases for updates from the server side. Tests must be offline and deterministic, so the
// release API is answered locally; every other request goes through untouched.
export function installGithubStub({ repository = "Ssshake1996/myterm", latestVersion, state = { requests: 0 } } = {}) {
  const original = globalThis.fetch;
  const releaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== releaseUrl) return original(input, init);
    state.requests += 1;
    const asset = `dsh-remote-ops-v${latestVersion}.tgz`;
    return Response.json({
      tag_name: `dsh-remote-ops-v${latestVersion}`,
      html_url: `https://github.com/${repository}/releases/tag/dsh-remote-ops-v${latestVersion}`,
      published_at: "2026-01-01T00:00:00Z",
      assets: [{ name: asset, browser_download_url: `https://example.invalid/${asset}` }],
    });
  };
  return { state, restore() { globalThis.fetch = original; } };
}
