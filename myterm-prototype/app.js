"use strict";

/* ── 假数据 ── */

const SESSIONS = [
  { id: "s1", name: "prod-web-01", host: "192.168.1.10", user: "root", group: "生产环境", state: "on" },
  { id: "s2", name: "prod-web-02", host: "192.168.1.11", user: "root", group: "生产环境", state: "off" },
  { id: "s3", name: "db-master", host: "192.168.1.20", user: "dba", group: "生产环境", state: "on" },
  { id: "s4", name: "test-app-01", host: "10.0.3.15", user: "deploy", group: "测试环境", state: "off" },
];

let QUICK = [
  { group: "常用", label: "磁盘占用", command: "df -h", newline: true },
  { group: "常用", label: "内存", command: "free -h", newline: true },
  { group: "常用", label: "TCP 连接数", command: "ss -s", newline: true },
  { group: "部署", label: "查看服务", command: "systemctl status app", newline: true },
  { group: "部署", label: "重启 nginx", command: "sudo systemctl restart nginx", newline: false },
  { group: "排查", label: "追日志", command: "tail -f /var/log/app/app.log", newline: true },
  { group: "排查", label: "最近报错", command: "grep -n ERROR /var/log/app/app.log | tail -20", newline: true },
];
let activeGroup = "常用";

const FAKE_OUTPUT = {
  "df -h": `Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        99G   87G  6.9G  93% /
/dev/vdb1       500G  213G  262G  45% /data`,
  "free -h": `              total   used   free  shared  buff/cache  available
Mem:           15Gi   11Gi  1.2Gi   345Mi       3.1Gi       3.4Gi`,
  "ss -s": `Total: 892\nTCP:   861 (estab 214, closed 601, orphaned 2, timewait 598)`,
  "systemctl status app": `● app.service - Demo App
   Active: active (running) since Fri 2026-07-31 09:14:02 CST`,
  "tail -f /var/log/app/app.log": `2026-07-31 10:41:03 INFO  scheduler tick ok
2026-07-31 10:41:09 ERROR connect to redis 10.0.0.8:6379 timed out
2026-07-31 10:41:09 WARN  fallback to local cache`,
};

const AI_REPLY = {
  text: "从终端输出看,根分区已使用 93%,只剩 6.9G,这会触发多数服务的磁盘水位告警。建议先定位大文件目录:",
  code: "du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -10",
  tail: "确认后优先清理 /var/log 下的滚动日志与 /tmp。若 /data 有空间,可考虑把应用日志目录迁移过去。",
};

/* ── 工具 ── */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ── 标签页 ── */
const tabsData = [
  { id: "s1", title: "prod-web-01", dot: "on" },
  { id: "s3", title: "db-master", dot: "on" },
  { id: "local", title: "本地 PowerShell", dot: "warn" },
];
let activeTab = "s1";

function renderTabs() {
  const box = $("tabs");
  box.innerHTML = "";
  tabsData.forEach((t) => {
    const tab = el("div", "tab" + (t.id === activeTab ? " active" : ""));
    tab.append(el("span", "dot " + t.dot), el("span", "", t.title), el("span", "x", "✕"));
    tab.onclick = () => { activeTab = t.id; renderTabs(); syncConnInfo(t); };
    box.append(tab);
  });
}
function syncConnInfo(t) {
  const s = SESSIONS.find((x) => x.id === t.id);
  $("connInfo").textContent = s ? `${s.user}@${s.name} · ${s.host}` : "PS C:\\Users\\me(本地)";
  $("promptText").textContent = s ? `${s.user}@${s.name}:~#` : "PS C:\\Users\\me>";
}

/* ── 会话树 ── */
function renderTree(filter = "") {
  const tree = $("tree");
  tree.innerHTML = "";
  const groups = [...new Set(SESSIONS.map((s) => s.group))];
  groups.forEach((g) => {
    const items = SESSIONS.filter((s) => s.group === g &&
      (s.name.includes(filter) || s.host.includes(filter)));
    if (!items.length) return;
    tree.append(el("div", "tgroup", "▾ " + g));
    items.forEach((s) => {
      const it = el("div", "titem" + (s.id === activeTab ? " active" : ""));
      it.append(el("span", "dot " + s.state), el("span", "", s.name), el("small", "", s.host));
      it.ondblclick = it.onclick = () => {
        if (!tabsData.some((t) => t.id === s.id)) tabsData.push({ id: s.id, title: s.name, dot: "on" });
        activeTab = s.id; renderTabs(); renderTree($("treeSearch").value); syncConnInfo({ id: s.id });
        termLine("dim", `[已连接 ${s.user}@${s.host}:22 · 密钥认证 · xterm-256color]`);
      };
      tree.append(it);
    });
  });
}
$("treeSearch").oninput = (e) => renderTree(e.target.value.trim());
$("btnLocal").onclick = () => { activeTab = "local"; renderTabs(); syncConnInfo({ id: "local" }); termLine("dim", "[本地终端 PowerShell 7.4 已启动]"); };

/* ── 终端 ── */
function termLine(cls, text) {
  const line = el("div", cls, text);
  $("termScroll").append(line);
  $("termScroll").scrollTop = $("termScroll").scrollHeight;
}
function typeCommand(cmd, execute) {
  const typed = $("typedText");
  typed.textContent = cmd;
  if (!execute) return;
  setTimeout(() => {
    termLine("cmd", $("promptText").textContent + " " + cmd);
    const out = FAKE_OUTPUT[cmd];
    if (out) out.split("\n").forEach((l) => termLine(l.includes("ERROR") ? "err" : "out", l));
    else termLine("dim", "(原型演示:此命令无预置输出)");
    typed.textContent = "";
  }, 220);
}
// 初始终端内容
[
  ["cmd", "root@prod-web-01:~# systemctl status nginx"],
  ["out", "● nginx.service - A high performance web server"],
  ["err", "   Active: failed (Result: exit-code) since Fri 2026-07-31 10:38:11 CST"],
  ["out", '   Process: 8213 ExecStart=/usr/sbin/nginx (code=exited, status=1/FAILURE)'],
  ["cmd", "root@prod-web-01:~# df -h /"],
  ["out", "/dev/vda1        99G   87G  6.9G  93% /"],
].forEach(([c, t]) => termLine(c, t));

/* ── 终端/文件 视图切换 ── */
function showFiles(show) {
  $("terminalView").classList.toggle("hidden", show);
  $("filesView").classList.toggle("hidden", !show);
  $("segTerm").classList.toggle("active", !show);
  $("segFiles").classList.toggle("active", show);
}
$("segTerm").onclick = () => showFiles(false);
$("segFiles").onclick = $("actFiles").onclick = () => showFiles(true);

/* 上传演示 */
$("btnUpload").onclick = () => {
  let p = 0;
  const timer = setInterval(() => {
    p = Math.min(100, p + Math.random() * 9);
    $("uploadFill").style.width = p + "%";
    $("uploadInfo").textContent = p >= 100 ? "完成 · 12.4 MB/s" : `${p.toFixed(0)}% · 12.4 MB/s`;
    if (p >= 100) clearInterval(timer);
  }, 120);
};

/* ── 快捷命令栏 ── */
function renderQuickbar() {
  const gBox = $("qGroups"), cBox = $("qCmds");
  gBox.innerHTML = ""; cBox.innerHTML = "";
  [...new Set(QUICK.map((q) => q.group))].forEach((g) => {
    const b = el("button", "qgroup" + (g === activeGroup ? " active" : ""), g);
    b.onclick = () => { activeGroup = g; renderQuickbar(); };
    gBox.append(b);
  });
  QUICK.filter((q) => q.group === activeGroup).forEach((q) => {
    const b = el("button", "qcmd");
    b.append(document.createTextNode(q.label));
    if (!q.newline) b.append(el("span", "noenter", "⏎手动"));
    b.title = q.command + (q.newline ? "(自动回车)" : "(回填不执行)");
    b.onclick = () => { showFiles(false); typeCommand(q.command, q.newline); };
    cBox.append(b);
  });
}
$("qCollapse").onclick = () => {
  const bar = $("quickbar");
  const collapsed = bar.style.height === "10px";
  bar.style.height = collapsed ? "" : "10px";
  bar.style.overflow = collapsed ? "" : "hidden";
  $("qCollapse").textContent = collapsed ? "▾" : "▴";
};

/* 快捷命令编辑弹窗 */
$("qAdd").onclick = () => $("qModal").classList.remove("hidden");
$("qModalClose").onclick = $("qModalCancel").onclick = () => $("qModal").classList.add("hidden");
$("qModalSave").onclick = () => {
  const label = $("qLabel").value.trim(), command = $("qCommand").value.trim();
  if (label && command) {
    QUICK.push({ group: $("qGroup").value.trim() || "常用", label, command, newline: $("qNewline").checked });
    activeGroup = $("qGroup").value.trim() || "常用";
    renderQuickbar();
  }
  $("qModal").classList.add("hidden");
};

/* ── AI 面板 ── */
function aiUserMsg(text, withCtx) {
  const m = el("div", "msg user");
  if (withCtx) {
    m.append(el("div", "ctx",
      "[附带 prod-web-01 终端最近 80 行]\n● nginx.service … Active: failed (exit-code)\n/dev/vda1  99G  87G  6.9G  93% /"));
  }
  m.append(el("div", "", text));
  $("aiMsgs").append(m);
  $("aiMsgs").scrollTop = $("aiMsgs").scrollHeight;
}

function aiStreamReply() {
  const m = el("div", "msg ai");
  const body = el("div", "");
  m.append(body);
  $("aiMsgs").append(m);
  const send = $("aiSend");
  send.textContent = "停止"; send.classList.add("stop");

  let i = 0;
  const t1 = setInterval(() => {
    body.textContent = AI_REPLY.text.slice(0, i += 3);
    $("aiMsgs").scrollTop = $("aiMsgs").scrollHeight;
    if (i >= AI_REPLY.text.length) {
      clearInterval(t1);
      const block = el("div", "codeblock");
      const head = el("div", "code-head");
      const btnCopy = el("button", "", "复制");
      const btnFill = el("button", "", "▶ 回填终端");
      btnFill.onclick = () => { showFiles(false); typeCommand(AI_REPLY.code, false); };
      head.append(btnCopy, btnFill);
      const pre = el("pre", "", AI_REPLY.code);
      block.append(head, pre);
      m.append(block);
      const tail = el("div", "");
      tail.style.marginTop = "7px";
      m.append(tail);
      let j = 0;
      const t2 = setInterval(() => {
        tail.textContent = AI_REPLY.tail.slice(0, j += 3);
        $("aiMsgs").scrollTop = $("aiMsgs").scrollHeight;
        if (j >= AI_REPLY.tail.length) {
          clearInterval(t2);
          send.textContent = "发送"; send.classList.remove("stop");
        }
      }, 24);
    }
  }, 24);
}

function aiAsk(text) {
  aiUserMsg(text, $("ctxToggle").checked);
  setTimeout(aiStreamReply, 350);
}
$("aiSend").onclick = () => {
  const v = $("aiInput").value.trim();
  if (!v) return;
  $("aiInput").value = "";
  aiAsk(v);
};
$("aiInput").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("aiSend").click(); }
};
// Ctrl+Shift+A 抓屏提问
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    $("ctxToggle").checked = true;
    aiAsk("解释当前终端状态,若有报错给出修复命令");
  }
});
$("actAi").onclick = () => $("aiInput").focus();

/* ── AI 设置弹窗 ── */
$("btnAiSettings").onclick = $("actSettings").onclick = () => $("aiModal").classList.remove("hidden");
$("aiModalClose").onclick = $("aiModalCancel").onclick = $("aiModalSave").onclick = () => $("aiModal").classList.add("hidden");
document.querySelectorAll(".preset").forEach((p) => {
  p.onclick = () => {
    document.querySelectorAll(".preset").forEach((x) => x.classList.remove("active"));
    p.classList.add("active");
    $("fBaseUrl").value = p.dataset.url;
    $("fModel").value = p.dataset.model;
  };
});
$("btnTest").onclick = () => {
  $("testOk").classList.add("hidden");
  $("btnTest").textContent = "测试中…";
  setTimeout(() => { $("btnTest").textContent = "测试连接"; $("testOk").classList.remove("hidden"); }, 700);
};

/* ── 初始化 ── */
renderTabs();
syncConnInfo({ id: "s1" });
renderTree();
renderQuickbar();
