import { generateKeyPairSync } from "node:crypto";
import net from "node:net";
import ssh2 from "ssh2";

// ssh2 is CommonJS; its Server export is not visible as a named ESM import.
const { Server } = ssh2;

export const DEVICE_USER = "admin";
export const DEVICE_PASSWORD = "e2e-device-pass";
export const MORE_PROMPT = "--More--(Quit : q|Q)(Next Record : Enter)(Next Page : Space)(To End : G)";

let hostKey;
const getHostKey = () => hostKey ??= generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;

const lunLines = (count) => Array.from({ length: count }, (_, index) => `LUN-${String(index + 1).padStart(3, "0")}  online  RAID5  100GB`);

// A scripted vendor CLI: a REPL that is not a shell. It echoes what is typed (like a PTY), asks the same double
// confirmation as a storage array, pages long output, prints a parameter hint that leaves the typed text behind, and
// only clears the line on Ctrl+C. Everything the user (or an agent) types is recorded so tests can prove what reached it.
class DeviceCli {
  constructor(stream, device) {
    this.stream = stream;
    this.device = device;
    this.prompt = device.prompt;
    this.line = "";
    this.mode = "prompt";
    this.pending = [];
    this.confirmCommand = "";
    stream.write(`Welcome to ${device.name}\r\n${this.prompt}`);
    stream.on("data", (chunk) => this.input(chunk.toString("utf8")));
  }

  write(text) { this.stream.write(text); }

  input(data) {
    this.device.log.raw.push(data);
    for (const ch of data) this.key(ch);
  }

  key(ch) {
    if (ch === "\u0003") return this.interrupt();
    if (this.mode === "pager") return this.pagerKey(ch);
    if (ch === "\r" || ch === "\n") return this.enter();
    if (ch === "\u007f" || ch === "\b") { if (this.line) { this.line = this.line.slice(0, -1); this.write("\b \b"); } return undefined; }
    if (ch < " ") return undefined;
    this.line += ch;
    this.write(ch);
    return undefined;
  }

  interrupt() {
    this.device.log.interrupts += 1;
    this.line = "";
    this.pending = [];
    this.mode = "prompt";
    this.write(`^C\r\n${this.prompt}`);
  }

  enter() {
    const text = this.line.trim();
    if (this.mode === "confirm1" || this.mode === "confirm2") return this.confirmReply(text);
    this.device.log.commands.push(text);
    if (this.device.dropOn && text === this.device.dropOn) { this.device.dropConnections(); return undefined; }
    this.line = "";
    return this.execute(text);
  }

  confirmReply(reply) {
    this.device.log.replies.push(reply);
    this.line = "";
    if (reply.toLowerCase() === "y" && this.mode === "confirm1") {
      this.mode = "confirm2";
      this.write("\r\nAre you sure you really want to perform the operation?(y/n)");
    } else if (reply.toLowerCase() === "y") {
      this.mode = "prompt";
      this.device.log.executed.push(this.confirmCommand);
      this.write(`\r\nSuccess: ${this.confirmCommand}\r\n${this.prompt}`);
    } else if (reply.toLowerCase() === "n") {
      this.mode = "prompt";
      this.write(`\r\nOperation cancelled.\r\n${this.prompt}`);
    } else {
      this.write(`\r\nPlease answer y or n.(y/n)`);
    }
  }

  execute(text) {
    const done = (body) => this.write(`\r\n${body}${body ? "\r\n" : ""}${this.prompt}`);
    if (!text) return this.write(`\r\n${this.prompt}`);
    if (text === "show version") return done("Array OS 1.2.3 (build e2e)");
    if (/^delete lun \d+$/.test(text)) {
      this.mode = "confirm1";
      this.confirmCommand = text;
      return this.write(`\r\nWARNING: You are about to ${text}.\r\nHave you read warning message carefully?(y/n)`);
    }
    if (text === "show lun") return this.startPager(lunLines(60));
    if (/^flood \d+$/.test(text)) {
      const count = Math.min(5000, Number(text.split(" ")[1]));
      return done(Array.from({ length: count }, (_, index) => `line ${String(index + 1).padStart(4, "0")} ${"=".repeat(60)}`).join("\r\n"));
    }
    if (text === "show wide") return done(`WIDE ${Array.from({ length: 24 }, (_, index) => `col${String(index + 1).padStart(2, "0")}`).join(" ")} END-OF-ROW`);
    if (text === "show 中文") return done("状态：正常    容量：100GB");
    if (/^show host_group general\b.*=/.test(text)) {
      // The hint leaves the typed line in the edit buffer, so the next command is glued to it until Ctrl+C.
      this.line = text;
      return this.write(`\r\n${" ".repeat(37)}^\r\n[host_group_id=?]           [host_group_name=?]  [host_group_type=?]\r\n\r\n${this.prompt}${text}`);
    }
    if (text === "disconnect") { this.write("\r\nConnection closed by device.\r\n"); this.device.dropConnections(); return undefined; }
    if (text === "exit") { this.write("\r\nBye.\r\n"); this.stream.exit(0); this.stream.end(); return undefined; }
    return done(`ERROR: unknown command: ${text}`);
  }

  startPager(lines) {
    this.pending = lines;
    this.mode = "pager";
    this.write("\r\n");
    this.emitPage(20);
  }

  emitPage(count) {
    const page = this.pending.splice(0, count);
    this.write(page.join("\r\n") + (page.length ? "\r\n" : ""));
    if (this.pending.length) this.write(MORE_PROMPT);
    else this.leavePager();
  }

  leavePager() { this.mode = "prompt"; this.pending = []; this.write(`${this.prompt}`); }

  pagerKey(ch) {
    this.device.log.replies.push(ch === "\r" ? "<Enter>" : ch === " " ? "<Space>" : ch);
    this.write("\r\u001b[K");
    if (ch === "q" || ch === "Q") return this.leavePager();
    if (ch === "G") { this.write(this.pending.join("\r\n") + "\r\n"); return this.leavePager(); }
    return this.emitPage(ch === " " ? 20 : 1);
  }
}

function execCommand(device, stream, command) {
  device.log.execs.push(command);
  const echo = /^echo (.*)$/.exec(command);
  if (echo) { stream.write(`${echo[1]}\n`); stream.exit(0); }
  else if (command === "uname -a") { stream.write("FakeOS 1.0 e2e-device x86_64\n"); stream.exit(0); }
  else if (command === "fail") { stream.stderr.write("boom: simulated failure\n"); stream.exit(3); }
  else { stream.stderr.write(`sh: ${command}: command not found\n`); stream.exit(127); }
  stream.end();
}

export async function startFakeDevice({ name = "Fake Array", username = DEVICE_USER, password = DEVICE_PASSWORD, auth = "password", prompt = "admin:/>", dropOn } = {}) {
  const sockets = new Set();
  const log = { connections: 0, authAttempts: 0, raw: [], commands: [], replies: [], executed: [], execs: [], windows: [], interrupts: 0 };
  const device = { name, host: "127.0.0.1", port: 0, username, password, auth, prompt, log, dropOn, dropConnections: () => { for (const socket of sockets) socket.destroy(); } };
  const server = new Server({ hostKeys: [getHostKey()] }, (client) => {
    log.connections += 1;
    client.on("authentication", (context) => {
      log.authAttempts += 1;
      if (auth === "none" && context.method === "none") return context.accept();
      if (auth === "password" && context.method === "password" && context.username === username && context.password === password) return context.accept();
      return context.reject(auth === "password" ? ["password"] : ["none"]);
    });
    client.on("error", () => {});
    client.on("ready", () => client.on("session", (accept) => {
      const session = accept();
      session.on("env", (acceptEnv) => acceptEnv?.());
      session.on("pty", (acceptPty, _reject, info) => { log.windows.push({ event: "pty", rows: info.rows, cols: info.cols }); acceptPty(); });
      session.on("window-change", (acceptChange, _reject, info) => { log.windows.push({ event: "window-change", rows: info.rows, cols: info.cols }); acceptChange?.(); });
      session.on("shell", (acceptShell) => new DeviceCli(acceptShell(), device));
      session.on("exec", (acceptExec, _reject, info) => execCommand(device, acceptExec(), info.command));
    }));
  });
  const tcp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    server.injectSocket(socket);
  });
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  device.port = tcp.address().port;
  device.close = async () => { device.dropConnections(); await new Promise((resolve) => tcp.close(resolve)); server.close(); };
  return device;
}
