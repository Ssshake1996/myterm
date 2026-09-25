export function describeFailure(error, stage = "operation") {
  const chain = [], seen = new Set();
  for (let value = error; value && !seen.has(value) && chain.length < 5; value = value.cause) {
    seen.add(value);
    chain.push(`${value.code ? `[${value.code}] ` : ""}${value.stack ?? value.message ?? String(value)}`);
  }
  const details = chain.join("\nCaused by: ");
  const code = String(error?.code ?? "REMOTE_OPERATION_FAILED");
  let title = "操作未完成", recovery = "retry";
  if (/auth|credential|password/i.test(details)) { title = "认证失败，请检查凭据"; recovery = "credentials"; }
  else if (/SESSION_REQUIRED|OWNER_UNAVAILABLE|session\/not-found/.test(code)) { title = "需要选择可用的 Harness 会话"; recovery = "session"; }
  else if (/SESSION_NOT_FOUND|SESSION_EXITED|NO_SESSION/.test(code)) { title = "终端已断开"; recovery = "connect"; }
  else if (/MANUAL_CONTROL|AGENT_ACTIVE/.test(code)) { title = "终端输入由另一方持有"; recovery = "control"; }
  else if (/TRANSFER_EXISTS/.test(code)) { title = "目标文件已存在"; recovery = "conflict"; }
  else if (/EACCES|EPERM|Permission denied/.test(details)) { title = "目标拒绝访问"; recovery = "permissions"; }
  return { code, stage, title, recovery, message: String(error?.message ?? error), details };
}

export function diagnosticReport(snapshot) {
  // Export only operational metadata. Arbitrary strings may contain passwords or terminal input.
  return {
    generatedAt: new Date().toISOString(), pluginVersion: snapshot.pluginVersion,
    harnessVersion: snapshot.harnessVersion ?? null, platform: process.platform, nodeVersion: process.version,
    sessions: (snapshot.sessions ?? []).map((x, index) => ({ connection: index + 1, kind: x.kind, state: x.status?.kind })),
    events: (snapshot.events ?? []).map(x => ({ at: x.at, kind: x.kind, code: x.code, stage: x.stage, inputChars: x.inputChars, waitReason: x.waitReason })).slice(-100),
  };
}
