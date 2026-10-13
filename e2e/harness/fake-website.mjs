import http from "node:http";

// Local-only acceptance site. Counts actual requests so an accidental replay is observable.
export async function startFakeWebsite() {
  const log = { logins: 0, commands: [] };
  const login = `<h1>Web acceptance</h1><form method="post" action="/login"><label>Username<input name="username" id="username" autocomplete="username"></label><label>Password<input name="password" id="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>`;
  const consolePage = `<h1 id="signed-in">Signed in</h1><label>Command<input id="command"></label><button id="run">Run</button><pre id="output">Ready</pre><button id="slow">Slow result</button><button id="save">Save</button><p id="saved"></p><a id="popup" href="/popup" target="_blank">Open popup</a><iframe title="Command frame" src="/frame"></iframe><script>
    run.onclick=async()=>{output.textContent=await fetch('/command',{method:'POST',body:command.value}).then(r=>r.text())};
    slow.onclick=async()=>{output.textContent=await fetch('/slow').then(r=>r.text())};
    save.onclick=()=>{if(confirm('Save changes?')) saved.textContent='Saved'};
  </script>`;
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const body = async () => { let value = ""; for await (const part of request) value += part; return value; };
    response.setHeader("Cache-Control", "no-store");
    if (path === "/login" && request.method === "POST") {
      const fields = new URLSearchParams(await body());
      if (fields.get("username") !== "tester" || fields.get("password") !== "local-test-password") { response.writeHead(401); response.end("Invalid login"); return; }
      log.logins++; response.writeHead(303, { Location: "/console", "Set-Cookie": "signed=yes; HttpOnly; SameSite=Lax; Path=/" }); response.end(); return;
    }
    if (path === "/command") { const command = await body(); log.commands.push(command); response.end(`OK: ${command}`); return; }
    if (path === "/slow") { setTimeout(() => response.end("Slow finished"), 2500); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (path === "/frame") { response.end('<button id="frame-action" onclick="document.querySelector(\'p\').textContent=\'Frame done\'">Frame action</button><p id="frame-result">Waiting</p>'); return; }
    if (path === "/popup") { response.end('<h1 id="popup-result">Popup ready</h1>'); return; }
    const signed = /signed=yes/.test(request.headers.cookie ?? "");
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Local web fixture</title></head><body>${signed ? consolePage : login}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, log, close: () => new Promise(resolve => server.close(resolve)) };
}
