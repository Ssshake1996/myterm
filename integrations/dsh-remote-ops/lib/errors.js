export function summarizeError(error) {
  if (error === null || error === undefined) return "Unknown error";
  if (typeof error === "string") return error;
  const code = error.code ? ` [${error.code}]` : "";
  return `${error.message ?? String(error)}${code}`;
}

export function sessionError(code, message, cause) {
  const error = new Error(`${code}: ${message}${cause ? `; ${summarizeError(cause)}` : ""}`, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
