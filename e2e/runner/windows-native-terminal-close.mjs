import assert from "node:assert/strict";
import { join } from "node:path";

// Runs only inside the real installed DSH acceptance runner. All actions below
// use DSH's UI and registered plugin tools; no Agent or host code is patched.
export async function verifyTerminalClose({ p, url, editor, owner, closeProof, until, step, out, evidence }) {
  const check = async (name, work) => { await step(name, work); if (process.exitCode) throw new Error("Native close verification failed: " + name); };
  await p.setViewportSize({ width: 1500, height: 1000 });
  const primaryOwner = owner(), panel = p.locator(".dsh-remote-ops");
  const tabs = panel.getByRole("tablist", { name: "终端会话" });
  const all = () => panel.getByRole("button", { name: "全部关闭 SSH 标签", exact: true });
  const state = (page, id) => page.evaluate(id => fetch("/api/dsh-remote-ops/state?sessionId=" + encodeURIComponent(id), { headers: { "X-Remote-Ops-Acceptance": "read-only-observation" } }).then(r => r.json()), id);
  const send = async (field, text) => { await until(() => field.isEditable()); await field.fill(text); await field.press("Enter"); };
  let otherOwner, otherConnection;
  const q = p;
  const selectConversation = async id => {
    await p.locator(`[data-row-key="session:${id}"]`).click();
    await until(async () => owner() === id && (await tabs.getByRole("tab").first().getAttribute("id"))?.startsWith("remote-ops-terminal-tab-" + encodeURIComponent(id) + "-"));
  };
  try {
    await check("native conversations maintain separate live Windows SSH connections", async () => {
      assert.ok(primaryOwner);
      await q.getByRole("button", { name: "新建会话", exact: true }).last().click();
      await until(async () => { const key = await p.locator('[data-row-key^="session:"][aria-selected="true"]').getAttribute("data-row-key"); return key && key !== "session:" + primaryOwner; });
      if (!await q.locator(".dsh-remote-ops").isVisible()) await q.getByRole("button", { name: "Remote Ops", exact: true }).click();
      await until(() => owner() && owner() !== primaryOwner); otherOwner = owner();
      const field = q.getByRole("textbox", { name: /描述你想要|发消息或创建任务/ });
      await send(field, "WINDOWS_CLOSE_OTHER"); await until(() => closeProof.has("OTHER"), 90000);
      otherConnection = closeProof.get("OTHER")[0].sessionId; assert.ok(otherConnection, JSON.stringify(closeProof.get("OTHER")));
      await selectConversation(primaryOwner);
      assert.equal(owner(), primaryOwner);
      assert.equal((await state(p, primaryOwner)).sessions.filter(x => x.kind === "ssh").length, 2);
      const other = (await state(q, otherOwner)).sessions.filter(x => x.kind === "ssh");
      assert.equal(other.length, 1); assert.equal(other[0].sessionId, otherConnection);
      await until(async () => await tabs.locator('[data-state="connected"]').count() === 3);
      evidence.closeScope = { primaryOwner, otherOwner, otherConnection };
    });
    await check("native yellow Agent status permits manual Windows PTY input and one cancelable confirmation", async () => {
      await tabs.getByRole("tab", { name: "Windows 原生验收", exact: true }).last().click();
      await send(editor, "WINDOWS_CLOSE_BUSY");
      await until(async () => await tabs.locator('[data-state="busy"]').count() === 1);
      assert.match(await tabs.getByRole("tab", { name: "Windows 原生验收", exact: true }).last().getAttribute("aria-description"), /Agent/);
      const input = p.getByLabel("终端输入", { exact: true });
      assert.equal(await input.getAttribute("readonly"), null);
      await input.focus(); await p.keyboard.type('Write-Output ("HUMAN_" + "WITH_AGENT")'); await p.keyboard.press("Enter");
      await until(async () => (await p.getByLabel("终端输出", { exact: true }).innerText()).includes("HUMAN_WITH_AGENT"));
      await all().click(); assert.match(await p.getByRole("dialog").innerText(), /2 个连接未断开，1 个正在操作/);
      await p.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
      assert.equal((await state(p, primaryOwner)).sessions.filter(x => x.kind === "ssh").length, 2);
      await p.screenshot({ path: join(out, "terminal-yellow-manual.png"), animations: "disabled" });
    });
    await check("native narrow dark tabs retain the direct close button and reduced-motion status", async () => {
      await p.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await p.setViewportSize({ width: 390, height: 844 });
      assert.ok(await panel.evaluate(n => n.scrollWidth <= n.clientWidth + 1));
      await until(async () => { const b = await all().boundingBox(); return b && b.x >= 0 && b.x + b.width <= 390; });
      assert.equal(await tabs.locator('[data-state="busy"]').evaluate(n => getComputedStyle(n).animationName), "none");
      await p.screenshot({ path: join(out, "terminal-close-narrow-dark.png"), animations: "disabled" });
      await p.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
      await p.setViewportSize({ width: 1500, height: 1000 });
    });
    await check("native bulk close cancels the dedicated Windows exec and preserves CMD, environments and another conversation", async () => {
      await all().click(); await p.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
      await until(async () => await tabs.getByRole("tab").count() === 1);
      await until(() => closeProof.has("BUSY"));
      const result = closeProof.get("BUSY")[0];
      assert.equal(result.status, "cancelled", JSON.stringify(result)); assert.equal(result.terminationConfirmed, false);
      const current = await state(p, primaryOwner), other = await state(q, otherOwner);
      assert.equal(current.sessions.filter(x => x.kind === "ssh").length, 0);
      assert.equal(current.environments.length, 1); assert.equal(current.sessions[0].kind, "local");
      assert.ok(other.sessions.some(x => x.sessionId === otherConnection && x.status.kind !== "exited"));
      const input = p.getByLabel("终端输入", { exact: true }); await input.focus(); await p.keyboard.type("echo LOCAL_AFTER_CLOSE"); await p.keyboard.press("Enter");
      await until(async () => (await p.getByLabel("终端输出", { exact: true }).innerText()).includes("LOCAL_AFTER_CLOSE"));
      await new Promise(r => setTimeout(r, 3500)); assert.equal(await tabs.getByRole("tab").count(), 1);
      await p.screenshot({ path: join(out, "terminal-close-local-retained.png"), animations: "disabled" });
      evidence.cancelledWindowsCommand = result;
    });
    await check("native disconnected tabs clear without a dialog and closed logs remain discoverable", async () => {
      await selectConversation(otherOwner);
      const otherTabs = q.getByRole("tablist", { name: "终端会话" });
      await otherTabs.getByRole("tab", { name: "Windows 原生验收", exact: true }).click();
      await q.getByLabel("终端输入", { exact: true }).focus(); await q.keyboard.type("exit"); await q.keyboard.press("Enter");
      await until(async () => await otherTabs.locator('[data-state="disconnected"]').count() === 1);
      await q.screenshot({ path: join(out, "terminal-gray-disconnected.png"), animations: "disabled" });
      const clear = q.getByRole("button", { name: "全部关闭 SSH 标签", exact: true }); await clear.focus(); await q.keyboard.press("Enter");
      await until(async () => await otherTabs.getByRole("tab").count() === 1); assert.equal(await q.getByRole("dialog").count(), 0);
      await selectConversation(primaryOwner); await send(editor, "WINDOWS_CLOSE_LOGS"); await until(() => closeProof.has("LOGS"));
      assert.match(JSON.stringify(closeProof.get("LOGS")), /Windows 原生验收/);
      evidence.closedLogs = closeProof.get("LOGS");
    });
  } catch (error) {
    await p.screenshot({ path: join(out, "terminal-close-failure.png"), animations: "disabled" });
    evidence.closeProof = Object.fromEntries(closeProof);
    throw error;
  }
}
