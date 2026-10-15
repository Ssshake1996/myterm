import assert from 'node:assert/strict';

export const liveBrowserScenario={id:'web-live',title:'网址直开、实时画面、共享操作、对话取消与显示模式',async run(t){
  const p=t.page,info=await t.info();
  const call=(path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;},{path,body});
  const api=body=>call('/api/dsh-remote-ops/browser',{sessionId:info.sessionId,...body});
  const tool=(name,args)=>call('/e2e/agent',{tool:name,args});
  const snapshot=()=>call(`/api/dsh-remote-ops/browser?sessionId=${info.sessionId}`);
  const until=async f=>{for(let n=0;n<150;n++){const v=await f();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('browser did not settle');};
  let browser;
  await t.step('直接输入网址并打开插件内网页，无需保存网站',async()=>{
    await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.getByRole('tab',{name:'网页',exact:true}).click();
    await p.getByText('浏览器设置与高级功能',{exact:true}).click();await p.getByLabel('浏览器引擎',{exact:true}).selectOption('chrome');
    await p.getByRole('textbox',{name:'网页地址',exact:true}).fill(`${info.website.url}/login`);
    await p.getByRole('button',{name:'打开网页',exact:true}).click();
    await p.getByAltText('网页实时画面',{exact:true}).waitFor();
    await p.waitForFunction(()=>{const image=document.querySelector('img[alt="网页实时画面"]'),surface=document.querySelector('.dsh-remote-ops__liveSurface');return image&&surface&&image.getBoundingClientRect().bottom<=surface.getBoundingClientRect().bottom+1;});
    browser=(await snapshot()).sessions.find(v=>!v.closed);
    assert.equal(browser.display,'embedded');assert.equal((await snapshot()).sites.length,0);
    const tab=p.getByRole('tablist',{name:'网页标签页'}).getByRole('tab',{selected:true});assert.equal(await tab.getAttribute('tabindex'),'0');
    assert.equal(await p.locator('.dsh-remote-ops__webPage').getAttribute('id'),await tab.getAttribute('aria-controls'));
    for(const name of ['人工接管','接管','暂停','停止任务','执行下一步'])assert.equal(await p.getByRole('button',{name,exact:true}).count(),0);
  });
  await t.step('空 flowId 不阻止 Agent 在当前网页执行临时步骤',async()=>{
    await tool('remote_browser_run',{requestId:'live-user',flowId:'',steps:[{action:'fill',target:{kind:'css',value:'#username'},value:'tester'}]});
    await until(async()=>((await snapshot()).sessions.find(v=>v.id===browser.id)?.job?.status==='completed'));
    const result=await tool('remote_browser_read',{});assert.equal(result.browser.id,browser.id);
  });
  await t.step('Agent 执行期间，用户可在实时画面中点击并输入中文',async()=>{
    await api({action:'navigate',browserId:browser.id,url:`${info.website.url}/manual`});
    await tool('remote_browser_run',{requestId:'live-blank-flow',flowId:' \t ',pageId:null,variables:null,steps:[{action:'fill',target:{kind:'xpath',value:"//*[@id='entry']",frame:null,name:null},value:'空流程 ID 已执行',secretRef:null,timeoutMs:null,expectPopup:null,expect:{target:{kind:'css',value:'#echo',frame:''},text:'空流程 ID 已执行',state:null}}]});
    const blankJob=await until(async()=>{const job=(await snapshot()).sessions.find(v=>v.id===browser.id)?.job;return job&&!['running','stopping'].includes(job.status)&&job;});
    assert.equal(blankJob.status,'completed',JSON.stringify(blankJob.error));
    const equivalent=await tool('remote_browser_run',{requestId:'live-blank-flow',steps:[{action:'fill',target:{kind:'xpath',value:"//*[@id='entry']"},value:'空流程 ID 已执行',expect:{target:{kind:'css',value:'#echo'},text:'空流程 ID 已执行'}}]});
    assert.equal(equivalent.id,blankJob.id,'null and omitted options must keep the same accepted job');
    assert.match((await tool('remote_browser_read',{})).page.text,/空流程 ID 已执行/);
    await tool('remote_browser_run',{requestId:'live-human-during-agent',steps:[{action:'wait',target:{kind:'css',value:'#echo'},expect:{target:{kind:'css',value:'#echo'},text:'中文'}}]});
    const image=p.getByAltText('网页实时画面',{exact:true});
    await until(async()=>Number(await image.getAttribute('data-revision'))===(await snapshot()).sessions.find(v=>v.id===browser.id).revision);
    const current=(await snapshot()).sessions.find(v=>v.id===browser.id),bounds=await image.boundingBox();await image.click({position:{x:50*bounds.width/current.viewport.width,y:60*bounds.height/current.viewport.height}});await p.keyboard.insertText('中文');
    await until(async()=>(await tool('remote_browser_read',{})).page.text.includes('中文'));
    await until(async()=>((await snapshot()).sessions.find(v=>v.id===browser.id)?.job?.status==='completed'));
    await p.keyboard.press('Control+Escape');assert.equal(await p.getByRole('textbox',{name:'网页地址',exact:true}).evaluate(n=>document.activeElement===n),true);
  });
  await t.step('取消对话阻止后续网页步骤，人工输入始终可用',async()=>{
    await tool('remote_browser_run',{requestId:'live-stop',steps:[{action:'wait',target:{kind:'css',value:'#never'},timeoutMs:30000},{action:'fill',target:{kind:'css',value:'#manual'},value:'should-not-run'}]});
    const cancelledAt=Date.now();
    await call('/e2e/turn/cancel',{});
    await until(async()=>!((await snapshot()).sessions.find(v=>v.id===browser.id)?.job?.inFlight));
    const result=(await snapshot()).sessions.find(v=>v.id===browser.id).job;assert.notEqual(result.status,'completed');assert.equal(result.index,0);
    assert.equal(result.status,'stopped');assert.ok(Date.now()-cancelledAt<2000,'passive webpage waits should cancel promptly');
  });
  await t.step('切换模块及刷新不取消浏览器，终端也没有任务控制按钮',async()=>{
    await p.getByRole('textbox',{name:'网页地址',exact:true}).fill('https://unsent-draft.test/');
    await p.getByRole('tab',{name:'文件',exact:true}).click();
    let release,started,finished;const held=new Promise(resolve=>{release=resolve;}),loading=new Promise(resolve=>{started=resolve;}),handled=new Promise(resolve=>{finished=resolve;});
    const delay=async route=>{started();try{await held;await route.continue();}finally{finished();}};
    await p.route('**/api/dsh-remote-ops/browser?**',delay);
    try{
      await p.getByRole('tab',{name:'网页',exact:true}).click();await loading;
      assert.equal(await p.getByLabel('网页显示方式',{exact:true}).isDisabled(),true,'display must wait for the selected browser snapshot');
      assert.equal(await p.getByRole('button',{name:'打开网页',exact:true}).isDisabled(),true,'opening must not create a second browser before reconciliation');
    }finally{release();await handled;await p.unroute('**/api/dsh-remote-ops/browser?**',delay);}
    await p.getByAltText('网页实时画面',{exact:true}).waitFor();
    assert.equal(await p.getByRole('textbox',{name:'网页地址',exact:true}).inputValue(),'https://unsent-draft.test/');
    assert.equal((await snapshot()).sessions.find(v=>v.id===browser.id).closed,false);
    await p.reload();await p.locator('html[data-e2e-ready=true]').waitFor();
    await p.getByRole('button',{name:'Remote Ops',exact:true}).click();
    for(const name of ['人工接管','中断前台进程','停止等待'])assert.equal(await p.getByRole('button',{name,exact:true}).count(),0);
    await p.getByRole('tab',{name:'网页',exact:true}).click();await p.getByAltText('网页实时画面',{exact:true}).waitFor();
  });
  await t.step('空闲时切换独立窗口并保留当前网址，再返回插件内',async()=>{
    await p.getByLabel('网页显示方式',{exact:true}).selectOption('window');
    await p.getByRole('button',{name:'显示浏览器',exact:true}).waitFor();
    let current=(await snapshot()).sessions.find(v=>v.id===browser.id);assert.equal(current.display,'window');assert.match(current.pages[0].url,/manual/);
    await p.getByLabel('网页显示方式',{exact:true}).selectOption('embedded');await p.getByAltText('网页实时画面',{exact:true}).waitFor();
    assert.equal((await snapshot()).sessions.find(v=>v.id===browser.id).display,'embedded');
  });
  await t.step('390px 布局无横向溢出，网页状态与画面可见',async()=>{
    await p.getByRole('button',{name:'新建网页',exact:true}).click();
    await p.getByRole('tab',{name:'新标签页',exact:true,selected:true}).waitFor();
    await until(async()=>await p.getByRole('textbox',{name:'网页地址',exact:true}).inputValue()==='');
    const tabs=p.getByRole('tablist',{name:'网页标签页'}).getByRole('tab');await tabs.last().focus();await p.keyboard.press('ArrowLeft');
    await until(async()=>await tabs.first().getAttribute('aria-selected')==='true');
    await p.setViewportSize({width:390,height:844});
    const overflow=await p.locator('.dsh-remote-ops__web').evaluate(n=>n.scrollWidth-n.clientWidth);assert.ok(overflow<=1);
  });
  await tool('remote_browser_control',{action:'close'});
}};
