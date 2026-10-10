export function redactLaunchOutput(value) {
  return String(value ?? "").replace(/token=[A-Za-z0-9._~-]+/g, "token=[redacted]");
}

// dsh web prints one line containing the browser URL and its launch token.
export function parseWebUrl(output) {
  const match = String(output).match(/https?:\/\/127\.0\.0\.1:\d+\/\?[^\s]*\btoken=[^\s&]+/);
  if (!match) return null;
  const url = new URL(match[0]);
  const token = url.searchParams.get("token");
  if (!token) return null;
  return { url: url.toString(), token, origin: url.origin };
}
