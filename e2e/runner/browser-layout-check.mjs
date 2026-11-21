import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const titles = { overview: '设备概览', ports: '端口状态', legacy: '固定宽度设备', compact: '定宽设备控制台', framed: '设备内嵌表单', wide: '宽屏设备', startup: '首次加载宽度', 'desktop-edge':'固定桌面验收', 'desktop-long':'长页面验收', 'desktop-nested':'内部滚动验收', 'desktop-clip':'裁剪布局验收' };

titles.scrollbars='滚动条验收';
titles.dialog='原生弹窗验收';
export function serveLayoutFixture(path, response, origin) {
  const name = path.split('/').at(-1);
  if (path === '/panel/form') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><style>*{box-sizing:border-box}body{margin:0}main{width:1060px;height:100vh;position:relative}button{position:absolute;right:5px;bottom:5px;width:80px;height:40px}</style><main><button id="apply">应用设置</button></main><script>apply.onclick=()=>parent.postMessage("applied","*")</script>');
    return true;
  }
  if (!path.startsWith('/panel/') || !Object.hasOwn(titles, name)) return false;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if(name==='dialog'){
    response.end(`<!doctype html><meta charset="utf-8"><title>${titles.dialog}</title><button id="modal" onclick="document.querySelector('output').textContent=confirm('Confirm operation')?'confirmed':'cancelled'">打开确认框</button><output>ready</output>`);return true;
  }
  if(name==='scrollbars'){
    response.setHeader('Content-Security-Policy',"style-src 'nonce-fixture'");
    response.end(`<!doctype html><title>${titles.scrollbars}</title><style nonce="fixture">html,body{margin:0}body{font:16px system-ui;color:#182230;background:#f8fafc}main{width:1600px;height:1800px;background:linear-gradient(#f1f5f9,#cbd5e1)}output{position:fixed;top:20px;left:30px;max-width:850px;padding:10px;background:white;color:#182230}button{position:fixed;left:30px;top:100px;padding:10px}input{position:fixed;left:160px;top:100px}html[data-dark=true]{color-scheme:dark}html[data-dark=true] main{background:#0f172a}</style><main><output id="status"></output><button id="theme">切换配色</button><input id="draft" aria-label="滚动草稿"></main><script>let clicks=0;const report=()=>document.querySelector('output').textContent='scroll='+scrollX+','+scrollY+'; clicks='+clicks+'; draft='+draft.value+'; colors='+getComputedStyle(document.documentElement,'::-webkit-scrollbar-thumb').backgroundColor+' '+getComputedStyle(document.documentElement,'::-webkit-scrollbar-track').backgroundColor;theme.onclick=()=>{document.documentElement.dataset.dark=document.documentElement.dataset.dark!=='true';clicks++;report()};addEventListener('scroll',report);addEventListener('load',report);</script>`);return true;
  }
  if(name.startsWith('desktop-')){
    const nested=name==='desktop-nested',clipped=name==='desktop-clip',height=name==='desktop-edge'?768:1400;
    response.end(`<!doctype html><meta charset="utf-8"><title>${titles[name]}</title><style>html,body{margin:0;${clipped?'height:100%;overflow:clip;':''}}main{position:relative;width:1024px;height:${height}px}#pane{position:absolute;left:100px;top:80px;width:700px;height:400px;overflow:auto;background:#eef3f8}#content{height:1400px;position:relative}button{position:absolute;right:20px;bottom:20px;width:100px;height:40px}output{position:fixed;top:5px;left:5px}input{position:absolute;top:40px;left:20px}</style>
    <main style="${nested?'height:600px':''}"><output id="result">ready</output><output id="scroll-result" style="left:200px"></output><input id="draft" aria-label="草稿">${nested?'<section id="pane"><div id="content">':''}<button id="edge">保存布局</button>${nested?'</div></section>':''}</main><script>let clicks=0;edge.onclick=()=>result.textContent='saved-'+ ++clicks;${nested?"pane.onscroll=()=>document.getElementById('scroll-result').textContent='scroll='+pane.scrollTop;":''}</script>`);return true;
  }
  if (name === 'startup') {
    response.end('<!doctype html><title>首次加载宽度</title><output></output><script>document.querySelector("output").textContent="startup-width="+innerWidth;if(innerWidth>=1280)document.body.insertAdjacentHTML("beforeend","<button>设备配置</button>");</script>');
    return true;
  }
  if (name === 'framed') {
    response.end(`<!doctype html><title>${titles.framed}</title><style>*{box-sizing:border-box}body{margin:0}header{height:48px}section{height:calc(100vh - 48px);display:flex}nav{width:180px;flex:none}iframe{border:0;flex:1;min-width:0}output{display:block}</style>
      <header>设备设置 <output></output></header><section><nav>系统</nav><iframe src="${origin.replace('127.0.0.1', 'localhost')}/panel/form"></iframe></section>
      <script>onmessage=e=>{const frame=document.querySelector('iframe');if(e.source===frame?.contentWindow&&e.data==='applied'){document.querySelector('output').textContent='设置已应用';frame.remove();}}</script>`);
    return true;
  }
  response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>${titles[name]}</title>
    <style>*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui;color:#233643;background:#eef3f4}
    main{height:100vh;${name === 'compact' ? 'width:320px;' : ''}min-width:${name === 'wide' ? '1280px' : name === 'legacy' ? '1100px' : '0'};position:relative;padding:56px 6%;background:linear-gradient(#f7fafa,#e2ecee)}
    h1{font-size:24px;margin:6px 0 20px}p{margin:0}table{width:100%;background:white;border-collapse:collapse}th,td{border-bottom:1px solid #d4e0e3;padding:8px;text-align:left}
    button{position:absolute;background:#235565;color:white;border:0;border-radius:4px;width:64px;height:36px}
    .t{top:3px}.b{bottom:3px}.l{left:3px}.r{right:3px}footer{padding:30px}</style>
    <main><p>设备管理</p><h1>${titles[name]}</h1><table><tr><th>接口</th><th>状态</th><th>速率</th></tr><tr><td>GE 1/0/1</td><td>已连接</td><td>1 Gbps</td></tr><tr><td>GE 1/0/2</td><td>已连接</td><td>1 Gbps</td></tr></table>
    ${[['tl','左上'],['tr','右上'],['bl','左下'],['br','右下']].map(([id,label]) => `<button id="${id}" class="${id[0]} ${id[1]}">${label}</button>`).join('')}
    <input id="draft" aria-label="设备名称"><output id="last"></output></main>${name === 'compact' ? '' : '<footer>接口列表末尾</footer>'}
    <script>draft.oninput=()=>last.textContent=draft.value;document.onclick=e=>{if(e.target.tagName==='BUTTON')last.textContent='hit-'+e.target.id}</script></html>`);
  return true;
}

export async function checkBrowserLayout({page,owner,api,snapshot,until,step,url,out,evidence}) {
  const active=async()=>{const state=await snapshot();return state.sessions.find(s=>s.id===state.activeBrowserId&&!s.closed);};
  const image=page.getByAltText('网页实时画面',{exact:true}),surface=image.locator('..');
  const list=page.getByRole('tablist',{name:'网页标签页'});
  const open=async name=>{
    await page.getByRole('textbox',{name:'网页地址'}).fill(url+'/panel/'+name);
    await page.getByRole('button',{name:'打开网页',exact:true}).click();
    await list.getByRole('tab',{name:titles[name],exact:true,selected:true}).waitFor();
  };
  const geometry=()=>until(async()=>{
    const r=await active();
    const box=await image.evaluate(n=>n.isConnected&&n.parentElement?{w:n.parentElement.clientWidth,h:n.parentElement.clientHeight,imageW:n.getBoundingClientRect().width,imageH:n.getBoundingClientRect().height,revision:Number(n.dataset.revision),loaded:n.naturalWidth>0}:null);
    if(!r||!box?.loaded||box.revision!==r.revision||box.w!==r.viewport.width||box.h!==r.viewport.height||box.w!==box.imageW||box.h!==box.imageH)return false;
    return {...box,width:r.viewport.width,height:r.viewport.height};
  });
  const panelSize=async(width,height)=>{
    await until(async()=>{const b=await surface.boundingBox(),win=page.viewportSize();if(Math.round(b.width)===width&&Math.round(b.height)===height)return true;await page.setViewportSize({width:win.width+width-Math.round(b.width),height:win.height+height-Math.round(b.height)});return false;});
    return geometry();
  };
  const run=async steps=>{
    await api('browser',{sessionId:owner,action:'run',steps});
    const r=await until(async()=>{const r=await active();return r.job&&['completed','failed','unknown'].includes(r.job.status)&&r;});
    assert.equal(r.job.status,'completed',r.job.error?.message);
  };
  const webSettings=async()=>{
    await page.locator('.dsh-remote-ops__headAction[aria-label="设置"]').click();
    await page.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'网页',exact:true}).click();
    await page.getByLabel('浏览器引擎',{exact:true}).waitFor();
  };
  evidence.panelLayout={};
  await page.getByRole('tab',{name:'网页',exact:true}).click();
  await step('网页设置只有引擎和显示方式，没有视口或缩放模式',async()=>{
    await webSettings();
    for(const label of ['网页视口','网页画面缩放','桌面视口宽度','桌面视口高度','网站最低宽度'])assert.equal(await page.getByLabel(label,{exact:true}).count(),0);
    await page.getByRole('button',{name:'返回工作区',exact:true}).click();
  });
  await step('鼠标仍按住分栏时，网页宽高实时跟随且草稿保留',async()=>{
    await open('overview');const initial=await geometry();
    await run([{action:'fill',target:'#draft',value:'保留草稿'}]);
    const divider=await page.locator('[data-side="rightbar"]').boundingBox();assert.ok(divider);
    const x=divider.x+divider.width/2,y=divider.y+divider.height/2,samples=[];
    await page.mouse.move(x,y);await page.mouse.down();
    try {
      for(const dx of [55,110,40]){
        await page.mouse.move(x+dx,y,{steps:6});
        samples.push(await geometry());
      }
    }finally{await page.mouse.up();}
    assert.ok(new Set(samples.map(v=>v.width)).size>1);
    assert.match((await api('browser',{sessionId:owner,action:'observe'})).result.text,/保留草稿/);
    evidence.panelLayout.drag={initial,samples};
  });
  await step('1027×768 面板原字号显示宽页面，网页横滚到最右侧后可点击并录制',async()=>{
    await page.locator('[data-sidebar-right-mode="fullscreen"]').first().click();
    await open('wide');await panelSize(1027,768);
    const r=await active(),recording=(await api('browser',{sessionId:owner,action:'recording',recording:{action:'start'}})).result;
    await image.hover({position:{x:500,y:350}});await page.mouse.wheel(1600,0);
    const frame=await until(async()=>{const f=await api('browser/frame?'+new URLSearchParams({sessionId:owner,browserId:r.id}));return f.scrollX>200&&f;});
    await until(async()=>Number(await image.getAttribute('data-sequence'))>=frame.sequence);
    const x=1280-35-frame.scrollX,y=21-frame.scrollY;
    await image.click({position:{x,y}});
    await until(async()=>(await api('browser',{sessionId:owner,action:'observe'})).result.text.includes('hit-tr'));
    await api('browser',{sessionId:owner,action:'recording',recording:{action:'stop',recordingId:recording.id}});
    const log=(await api('browser',{sessionId:owner,action:'recording',recording:{action:'read',recordingId:recording.id,limit:200}})).result;
    assert.ok(log.events.some(e=>e.action==='click'&&e.target?.css==='#tr'&&Math.abs(e.pointer.x-x)<3));
    evidence.panelLayout.wide={...(await geometry()),scrollX:frame.scrollX,click:{x,y}};
  });
  await step('横纵滑块可拖到边缘，高对比配色经过严格 CSP、刷新与深浅切换',async()=>{
    await open('scrollbars');await panelSize(1027,768);
    const r=await active(),base={sessionId:owner,browserId:r.id};
    const read=async()=>(await api('browser',{...base,action:'observe'})).result.text;
    await until(async()=>/rgb\(71, 85, 105\) rgb\(226, 232, 240\)/.test(await read()));
    await page.screenshot({path:join(out,'scrollbars-light.png')});
    const rect=await image.boundingBox();
    const drag=async(from,to)=>{
      await page.mouse.move(rect.x+from.x,rect.y+from.y);await page.mouse.down();
      try{await page.mouse.move(rect.x+to.x,rect.y+to.y,{steps:25});}finally{await page.mouse.up();}
    };
    await drag({x:100,y:760},{x:1100,y:760});
    await until(async()=>/scroll=58[0-9],0/.test(await read()));
    await drag({x:1019,y:70},{x:1019,y:900});
    await until(async()=>/scroll=58[0-9],104[0-9]/.test(await read()));
    const result=await read();assert.match(result,/clicks=0/);
    await page.screenshot({path:join(out,'scrollbars-dragged.png')});
    // A real click following a drag still fires once and changes the native color scheme.
    await image.click({position:{x:70,y:120}});
    await until(async()=>/clicks=1/.test(await read())&&/rgb\(203, 213, 225\) rgb\(30, 41, 59\)/.test(await read()));
    await page.screenshot({path:join(out,'scrollbars-dark.png')});
    // Cancel while the button is held by leaving the workspace, then return and click.
    await page.mouse.move(rect.x+300,rect.y+760);await page.mouse.down();
    await page.mouse.move(rect.x+200,rect.y+760,{steps:6});
    await page.getByRole('tab',{name:'终端',exact:true}).focus();await page.keyboard.press('Enter');await page.mouse.up();
    await page.getByRole('tab',{name:'网页',exact:true}).click();await geometry();
    await image.click({position:{x:70,y:120}});
    await until(async()=>/clicks=2/.test(await read()));
    await api('browser',{...base,action:'navigate',navigation:'reload'});await geometry();
    await until(async()=>/clicks=0/.test(await read())&&/rgb\(71, 85, 105\)/.test(await read()));
    evidence.panelLayout.scrollbars={twoAxisDrag:true,outsideCapture:true,noExtraClick:true,workspaceCancellation:true,csp:true,lightAndDark:true,refresh:true};
  });
  await step('人工点击产生的原生弹窗可接受、取消，有弹窗时也能关闭网页',async()=>{
    await open('dialog');await geometry();
    const r=await active(),base={sessionId:owner,browserId:r.id};
    const notice=page.locator('.dsh-remote-ops__webNotice').filter({hasText:'网页弹窗：Confirm operation'});
    for(const [control,result] of [['dialog-accept','confirmed'],['dialog-dismiss','cancelled']]){
      await image.click({position:{x:45,y:18}});
      await until(async()=>(await active()).dialog);
      await notice.waitFor({state:'visible'});
      await api('browser',{...base,action:'control',control});
      await until(async()=>(await api('browser',{...base,action:'observe'})).result.text.includes(result));
      await notice.waitFor({state:'hidden'});
      await geometry();
    }
    await image.click({position:{x:45,y:18}});await until(async()=>(await active()).dialog);
    await api('browser',{...base,action:'control',control:'close-page',value:r.activePageId});
    await until(async()=>!(await active())?.pages.some(p=>p.id===r.activePageId));
    await list.waitFor({state:'hidden'});
    evidence.panelLayout.dialogs={accept:true,dismiss:true,closeWithPendingInput:true};
  });
  await step('宽高独立变化，页面保持原字号、登录上下文与草稿',async()=>{
    await open('overview');await run([{action:'fill',target:'#draft',value:'跨尺寸草稿'}]);
    const samples=[];
    for(const [w,h] of [[390,640],[900,420],[1027,768]])samples.push(await panelSize(w,h));
    assert.match((await api('browser',{sessionId:owner,action:'observe'})).result.text,/跨尺寸草稿/);
    evidence.panelLayout.sizes=samples;
  });
  await step('Agent 自动滚动长页面和内部容器，人工滚轮命中当前指针所在容器',async()=>{
    await open('desktop-long');await run([{action:'click',target:'#edge'}]);
    assert.match((await api('browser',{sessionId:owner,action:'observe'})).result.text,/saved-1/);
    await open('desktop-nested');await geometry();
    await image.hover({position:{x:350,y:250}});await page.mouse.wheel(0,450);
    await until(async()=>/scroll=[4-9]\d\d/.test((await api('browser',{sessionId:owner,action:'observe'})).result.text));
    await run([{action:'click',target:'#edge'}]);
    assert.match((await api('browser',{sessionId:owner,action:'observe'})).result.text,/saved-1/);
  });
  await step('尺寸请求失败只显示一次，详情不改变画面尺寸，手动重试恢复',async()=>{
    await open('overview');await geometry();let failures=0;
    const pattern='**/api/dsh-remote-ops/browser';
    const handler=async route=>{
      const body=route.request().method()==='POST'?route.request().postDataJSON():null;
      if(body?.action==='viewport'){failures++;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'BROWSER_VIEWPORT_TEST',error:'isolated resize failure'})});}
      else await route.continue();
    };
    await page.route(pattern,handler);
    try {
      const win=page.viewportSize();await page.setViewportSize({width:win.width,height:win.height-25});
      const notice=page.locator('.dsh-remote-ops__viewportError');await notice.waitFor();
      const before=await surface.boundingBox();await notice.locator('summary').click();
      assert.match(await notice.innerText(),/HTTP 400/);assert.match(await notice.innerText(),/BROWSER_VIEWPORT_TEST/);
      assert.match(await notice.innerText(),/\/api\/dsh-remote-ops\/browser/);
      await new Promise(r=>setTimeout(r,1400));
      assert.equal(failures,1);assert.deepEqual(await surface.boundingBox(),before);
      evidence.panelLayout.failure={requests:failures,details:true};
    }finally{await page.unroute(pattern,handler);}
    await page.getByRole('button',{name:'重试尺寸同步',exact:true}).click();
    await page.locator('.dsh-remote-ops__viewportError').waitFor({state:'hidden'});await geometry();
  });
  await step('刷新与新标签继续跟随面板，旧设置不会恢复',async()=>{
    await api('browser',{action:'preferences.save',preferences:{zoom:'actual',viewport:'desktop',desktopWidth:3200,desktopHeight:1600}});
    assert.equal((await snapshot()).preferences.zoom,undefined);
    await page.reload();await page.getByRole('tab',{name:'网页',exact:true}).waitFor();await geometry();
    await page.getByRole('button',{name:'新建网页',exact:true}).click();
    await list.getByRole('tab',{name:'新标签页',selected:true,exact:true}).waitFor();
    await open('ports');await geometry();
    await page.getByRole('button',{name:'关闭网页标签 '+titles.ports,exact:true}).click();await geometry();
  });
  await writeFile(join(out,'panel-layout.json'),JSON.stringify(evidence.panelLayout,null,2));
}
