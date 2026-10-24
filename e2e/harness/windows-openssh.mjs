import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir, userInfo } from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";

// A real Microsoft OpenSSH process, isolated from the machine's service/configuration.
// Key login as the current test user; no global authorized_keys, firewall or registry edits.
export async function startWindowsOpenSsh({ bin, root, username = userInfo().username, passwordAuthentication = false, debug = false } = {}) {
  if (process.platform !== "win32") throw new Error("A real Windows host is required");
  bin = resolve(bin ?? process.env.WINDOWS_OPENSSH_BIN ?? "C:/Windows/System32/OpenSSH");
  root = root ? resolve(root) : await mkdtemp(join(tmpdir(), "remote-ops-ssh-"));
  await mkdir(root, { recursive: true });
  for (const name of ["host", "client"]) {
    try { await readFile(join(root, name)); }
    catch { execFileSync(join(bin, "ssh-keygen.exe"), ["-t", "ed25519", "-f", join(root, name), "-N", ""], { windowsHide: true, stdio: "ignore" }); }
  }
  await writeFile(join(root, "authorized_keys"), await readFile(join(root, "client.pub")));
  const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-5-[0-9-]+/)[0];
  for (const name of ["authorized_keys", "client", "host"]) {
    const file = join(root, name);
    execFileSync("icacls.exe", [file, "/inheritance:r", "/grant:r", `*${sid}:(F)`], { windowsHide: true, stdio: "ignore" });
  }
  const listener = net.createServer();
  await new Promise(r => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const path = value => value.replaceAll("\\", "/");
  const config = join(root, "sshd_config");
  await writeFile(config, `ListenAddress 127.0.0.1\nPort ${port}\nHostKey "${path(root)}/host"\nAuthorizedKeysFile "${path(root)}/authorized_keys"\nPasswordAuthentication ${passwordAuthentication ? "yes" : "no"}\nPubkeyAuthentication yes\nAllowUsers ${username}\nSubsystem sftp "${path(bin)}/sftp-server.exe"\nLogLevel VERBOSE\n`);
  const child = spawn(join(bin, "sshd.exe"), ["-D", "-e", ...(debug ? ["-d"] : []), "-f", config], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "", spawnError;
  child.stderr.on("data", chunk => { log = (log + chunk).slice(-100000); });
  child.once("error", error => { spawnError = error; });
  const close = async () => {
    if (child.exitCode === null) {
      try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { child.kill(); }
    }
    // Win32 console descendants can retain inherited pipe handles after sshd exits.
    // Release our readers after teardown; a failed assertion still keeps exitCode=1.
    child.stdout.destroy(); child.stderr.destroy(); child.unref();
    await writeFile(join(root, "sshd.log"), log);
  };
  try {
    const deadline = Date.now() + 10000;
    while (!log.includes("Server listening")) {
      if (spawnError || child.exitCode !== null || Date.now() > deadline) throw new Error(`OpenSSH startup failed: ${spawnError?.message ?? log}`);
      await new Promise(r => setTimeout(r, 50));
    }
  } catch (error) { await close(); throw error; }
  const publicKey = (await readFile(join(root, "host.pub"), "utf8")).split(" ")[1];
  const hostKeySha256 = "SHA256:" + createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("base64").replace(/=+$/, "");
  return { root, bin, port, pid: child.pid, close, environment: { id: "windows-live", name: "Windows OpenSSH test", host: "127.0.0.1", port, username, privateKeyPath: join(root, "client"), hostKeySha256, transport: "ssh", platform: "windows", shell: "cmd" } };
}
