import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const terminalLogsScenario = { id: 'terminal-logs', title: '终端命令配色、日志接口与一键打包', async run(t) {
  const p = t.page;
  const tool = (name, args = {}) => p.evaluate(async ({name,args}) => {
    const response = await fetch('/e2e/agent', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:name,args})});
    const value = await response.json(); if (!response.ok) throw Error(value.error); return value;
  }, {name,args});
  await p.getByRole('button',{name:'Remote Ops',exact:true}).click();
  await p.getByLabel('终端输出',{exact:true}).waitFor();
  await t.step('Agent 命令与回显有不同颜色且文本保持一致', async () => {
    await tool('remote_terminal_send',{session:'local-cmd',text:'echo LOG070',quietMs:100});
    const command=p.locator('[data-terminal-role="agent-command"]').filter({hasText:'echo LOG070'}); await command.waitFor();
    assert.equal(await command.innerText(),'echo LOG070');
    assert.notEqual(await command.evaluate(n=>getComputedStyle(n).color),await p.getByLabel('终端输出',{exact:true}).evaluate(n=>getComputedStyle(n).color));
    await tool('remote_terminal_send',{session:'local-cmd',text:'echo ERROR: fixture failure',quietMs:100});
    await p.locator('[data-tone="error"]').filter({hasText:'ERROR: fixture failure'}).waitFor();
    const text=await p.getByLabel('终端输出',{exact:true}).innerText();
    await p.getByLabel('终端显示设置',{exact:true}).click();await p.getByLabel('命令与关键状态高亮',{exact:true}).uncheck();
    assert.equal(await p.locator('[data-terminal-role="agent-command"]').count(),0);
    assert.equal(await p.getByLabel('终端输出',{exact:true}).innerText(),text);
    await p.getByLabel('命令与关键状态高亮',{exact:true}).check();await p.getByLabel('终端显示设置',{exact:true}).click();
    await t.shot('命令与错误高亮');
  });
  await t.step('工具读取与界面单终端下载一致', async () => {
    const logs=await tool('remote_terminal_logs'),log=logs.logs.find(item=>item.sessionId==='local-cmd');
    const read=await tool('remote_terminal_log_read',{logId:log.logId});assert.match(read.text,/LOG070/);
    await p.getByLabel('导出终端日志',{exact:true}).click();
    const download=p.waitForEvent('download');await p.getByRole('button',{name:'导出当前终端 TXT',exact:true}).click();
    const file=await download;assert.match(file.suggestedFilename(),/\.txt$/);
    const text=await readFile(await file.path(),'utf8');assert.match(text,/echo LOG070\nLOG070/);assert.ok(!text.includes('\x1b'));
  });
  await t.step('窄屏一键下载 ZIP，日志接口提供真实包链接', async () => {
    await p.setViewportSize({width:390,height:844});await p.getByLabel('导出终端日志',{exact:true}).click();
    const download=p.waitForEvent('download');await p.getByRole('button',{name:'一键打包本会话全部日志',exact:true}).click();
    const file=await download,data=await readFile(await file.path());assert.equal(data.readUInt32LE(0),0x04034b50);
    const result=await tool('remote_terminal_log_export',{all:true,format:'zip'});assert.match(result.downloadPath,/^\/api\/dsh-remote-ops\/log-download\?/);assert.equal(result.manifest.logs.length,1);
    assert.ok(await p.locator('.dsh-remote-ops').evaluate(n=>n.scrollWidth-n.clientWidth)<=1);
    await t.shot('窄屏日志导出');
  });
}};
