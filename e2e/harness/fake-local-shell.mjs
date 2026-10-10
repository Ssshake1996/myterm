import { EventEmitter } from "node:events";

export const LOCAL_PROMPT = "e2e@local$ ";

// The DSH host gives the plugin a PTY for the shared local terminal. This stand-in behaves like a tiny interactive
// shell (echo, line editing, a few commands) so the UI can be exercised without a real PTY.
export function createFakeLocalShell({ rows = 40, cols = 160, onInput } = {}) {
  const output = new EventEmitter();
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let line = "";
  let closed = false;
  const emit = (text) => { if (!closed) output.emit("data", Buffer.from(text, "utf8")); };
  const finish = (outcome) => {
    if (closed) return;
    closed = true;
    output.emit("end");
    resolveDone(outcome);
  };
  const run = (text) => {
    const command = text.trim();
    if (!command) return emit(`\r\n${LOCAL_PROMPT}`);
    if (command === "exit") { emit("\r\nlogout\r\n"); return finish({ exitCode: 0, signal: null }); }
    const echo = /^echo\s+(.*)$/.exec(command);
    if (echo) return emit(`\r\n${echo[1]}\r\n${LOCAL_PROMPT}`);
    const flood = /^(?:seq|flood)\s+(\d+)$/.exec(command);
    if (flood) {
      const count = Math.min(5000, Number(flood[1]));
      return emit(`\r\n${Array.from({ length: count }, (_, index) => `line ${String(index + 1).padStart(4, "0")} ${"-".repeat(48)}`).join("\r\n")}\r\n${LOCAL_PROMPT}`);
    }
    return emit(`\r\nlocal: command not found: ${command}\r\n${LOCAL_PROMPT}`);
  };
  const terminal = {
    rows, cols, output, done,
    async write(text) {
      onInput?.(String(text));
      for (const ch of String(text)) {
        if (ch === "\r" || ch === "\n") { const submitted = line; line = ""; run(submitted); }
        else if (ch === "\u0003") { line = ""; emit(`^C\r\n${LOCAL_PROMPT}`); }
        else if (ch === "\u007f" || ch === "\b") { if (line) { line = line.slice(0, -1); emit("\b \b"); } }
        else if (ch >= " ") { line += ch; emit(ch); }
      }
    },
    async signalForeground() { line = ""; emit(`^C\r\n${LOCAL_PROMPT}`); return 4242; },
    async terminate() { finish({ exitCode: 0, signal: null }); },
  };
  setTimeout(() => emit(`${LOCAL_PROMPT}`), 0);
  return terminal;
}
