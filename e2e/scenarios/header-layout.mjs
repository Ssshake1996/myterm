import assert from 'node:assert/strict';

export async function verifyHeaderLayout(t,{sendSamples}) {
  const p=t.page,panel=p.locator('.dsh-remote-ops');
  const tabs=p.getByRole('tablist',{name:'Remote Ops 工作区'});
  const terminal=p.getByLabel('终端输出',{exact:true});
  await p.waitForFunction(()=>{const text=document.querySelector('.dsh-remote-ops__output')?.textContent;return text&&text!=='等待终端输出…';});
  const dimensions=async()=>panel.evaluate(root=>{
    const bounds=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};};
    const bar=root.querySelector('.dsh-remote-ops__workspaceBar');
    const settings=root.querySelector('[aria-label="设置"]');
    const strip=root.querySelector('.dsh-remote-ops__terminalHead');
    const env=strip.querySelector('[aria-label="环境管理"]');
    const nav=root.querySelector('.dsh-remote-ops__workspaceTabs');
    return {bar:bounds(bar),settings:bounds(settings),strip:bounds(strip),env:bounds(env),nav:bounds(nav),
      overflow:root.scrollWidth>root.clientWidth+1,workspaceOverflow:nav.scrollWidth>nav.clientWidth+1,
      separate:env.parentElement===strip&&!env.closest('[role="tablist"]'),
      title:!!root.querySelector('.dsh-remote-ops__brand'),
      tabs:[...nav.querySelectorAll('[role="tab"]')].map(bounds)};
  });
  await t.step('Two rows at 640px and 390px keep all workspaces, settings and environment discoverable',async()=>{
    for(const width of [640,390]){
      await panel.evaluate((node,width)=>{node.style.width=width+'px';node.style.maxWidth=width+'px';},width);
      await p.waitForTimeout(150);
      const d=await dimensions();
      assert.equal(d.title,false);assert.equal(d.separate,true);assert.equal(d.overflow,false);assert.equal(d.workspaceOverflow,false);
      assert.ok(d.settings.top>=d.bar.top&&d.settings.bottom<=d.bar.bottom+1);
      assert.ok(d.strip.height<=44);assert.ok(d.bar.height<=40);
      assert.ok(d.tabs.every(r=>r.left>=d.nav.left-1&&r.right<=d.nav.right+1));
      await p.getByRole('button',{name:'环境管理',exact:true}).click();
      const back=p.getByRole('button',{name:'关闭环境抽屉',exact:true});
      assert.match(await back.innerText(),/返回/);await back.click();
      await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='环境管理');
    }
  });
  await t.step('Every workspace retains an environment entry and returns without clearing terminal output',async()=>{
    const before=await terminal.innerText();
    for(const name of ['网页','桌面','文件','API']){
      await tabs.getByRole('tab',{name,exact:true}).click();
      const trigger=p.getByRole('button',{name:'环境管理',exact:true});await trigger.click();
      await p.getByRole('button',{name:'关闭环境抽屉',exact:true}).click();
      assert.equal(await tabs.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');
    }
    await tabs.getByRole('tab',{name:'终端',exact:true}).click();
    assert.equal(await terminal.innerText(),before);
  });
  await sendSamples();
  const sample=terminal.locator('span[style]').filter({hasText:/^CONTRAST_(ANSI|INDEX|RGB|DEFAULT)$/});
  await sample.first().waitFor();
  await t.step('ANSI 16/256/truecolor output meets 4.5:1 in both themes and opt-out leaves text intact',async()=>{
    const before=await terminal.innerText();
    const originalScheme=await p.evaluate(()=>document.documentElement.style.colorScheme);
    const ratios=()=>sample.evaluateAll(nodes=>{
      const rgb=v=>v.match(/[\d.]+/g).slice(0,3).map(Number);
      const l=v=>rgb(v).reduce((sum,c,i)=>{c/=255;return sum+(c<=.04045?c/12.92:((c+.055)/1.055)**2.4)*[.2126,.7152,.0722][i];},0);
      return nodes.map(n=>{const s=getComputedStyle(n),a=l(s.color),b=l(s.backgroundColor);return {text:n.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),bg:s.backgroundColor};});
    });
    try{
      for(const theme of ['light','dark']){
        await p.evaluate(theme=>{document.documentElement.style.colorScheme=theme;},theme);
        const checks=await ratios();assert.equal(checks.length,4);
        checks.forEach(v=>assert.ok(v.ratio>=4.5,`${theme} ${v.text}: ${v.ratio}`));
        await t.shot?.('terminal-contrast-'+theme);
      }
      await p.getByRole('button',{name:'设置',exact:true}).click();
      await p.getByLabel('文字对比度保护',{exact:true}).uncheck();
      assert.ok((await ratios()).some(v=>v.ratio<4.5));
      assert.equal(await terminal.innerText(),before);
      await p.getByLabel('文字对比度保护',{exact:true}).check();
      await p.getByRole('button',{name:'返回工作区',exact:true}).click();
      assert.equal(await terminal.innerText(),before);
    }finally{await p.evaluate(theme=>{document.documentElement.style.colorScheme=theme;},originalScheme);}
  });
  await panel.evaluate(n=>{n.style.width='';n.style.maxWidth='';});
}

export const headerLayoutScenario={id:'header-layout',title:'两行导航、环境入口与 ANSI 对比度保护',async run(t){
  await t.page.getByRole('button',{name:'Remote Ops',exact:true}).click();
  await t.page.getByLabel('终端输出',{exact:true}).waitFor();
  await verifyHeaderLayout(t,{sendSamples:()=>t.page.evaluate(async()=>{
    const r=await fetch('/e2e/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'remote_terminal_send',args:{session:'local-cmd',text:'contrast-samples',quietMs:100}})});
    if(!r.ok)throw Error(await r.text());
  })});
}};
