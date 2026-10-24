import assert from 'node:assert/strict';
import {createServer} from 'node:http';

export const layoutSimplificationScenario={id:'layout-simplification',title:'统一设置、后台徽标、JSON 树与不卸载的工作区',async run(t){
  const p=t.page,info=await t.info(),tab=name=>p.getByRole('tablist',{name:'Remote Ops 工作区'}).getByRole('tab',{name,exact:true});
  const call=(path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const value=await r.json();if(!r.ok)throw Error(value.error);return value;},{path,body});
  const tool=(tool,args={})=>call('/e2e/agent',{tool,args});
  const until=async predicate=>{for(let i=0;i<150;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('layout state did not settle');};
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,'a~/b':[{'':false,name:'fixture-value'}],empty:null,list:Array.from({length:3000},(_,i)=>i)}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.getByLabel('终端输出',{exact:true}).waitFor();
    await t.step('一个设置入口，搜索和单终端导出直接可用；设置往返保留 DOM',async()=>{
      assert.equal(await p.getByRole('button',{name:'设置',exact:true}).count(),1);
      assert.equal(await p.getByRole('button',{name:'搜索输出',exact:true}).isVisible(),true);
      assert.equal(await p.getByRole('button',{name:'导出当前终端 TXT',exact:true}).isVisible(),true);
      await p.getByLabel('终端输出',{exact:true}).evaluate(node=>{window.__layoutTerminal=node;});
      await p.getByRole('button',{name:'设置',exact:true}).click();
      assert.equal(await p.getByLabel('终端字号',{exact:true}).isVisible(),true);
      await p.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'通用',exact:true}).click();await t.shot('统一设置');
      await p.getByRole('button',{name:'返回工作区',exact:true}).click();assert.equal(await p.getByLabel('终端输出',{exact:true}).evaluate(node=>node===window.__layoutTerminal),true);
      assert.equal(await p.getByRole('button',{name:'设置',exact:true}).evaluate(node=>node===document.activeElement),true);
    });
    await t.step('后台真实终端输出提示，查看后清除',async()=>{
      await tab('API').click();await tool('remote_terminal_send',{session:'local-cmd',text:'echo BACKGROUND_LAYOUT',quietMs:100});
      await until(async()=>/新输出/.test(await tab('终端').innerText()));await t.shot('终端后台输出徽标');
      await tab('终端').click();await until(async()=>!/新输出/.test(await tab('终端').innerText()));
      assert.match(await p.getByLabel('终端输出',{exact:true}).innerText(),/BACKGROUND_LAYOUT/);
    });
    await t.step('API 树展开、转义路径复制、拒绝剪贴板回退和大数组边界',async()=>{
      const saved=await tool('remote_api_environment_save',{name:'Tree fixture',baseUrl:`http://127.0.0.1:${server.address().port}`,auth:{mode:'none'}});
      await tool('remote_api_request',{environment:saved.environment.id,requestId:'tree-response',path:'json'});
      await tab('API').click();await p.getByRole('button',{name:'展开 /a~0~1b',exact:true}).waitFor();
      await p.getByRole('button',{name:'展开 /a~0~1b',exact:true}).click();await p.getByRole('button',{name:'展开 /a~0~1b/0',exact:true}).click();
      await p.context().grantPermissions(['clipboard-read','clipboard-write']);
      await p.getByRole('button',{name:'复制 JSON Pointer /a~0~1b/0/',exact:true}).click();
      await until(async()=>await p.getByLabel('JSON Pointer',{exact:true}).inputValue()==='/a~0~1b/0/');
      assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),'/a~0~1b/0/');
      await p.evaluate(()=>{Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(Error('policy denied'))});});
      await p.getByRole('button',{name:'复制 JSON Pointer /empty',exact:true}).click();await p.getByText('无法自动复制，请选择下方路径复制',{exact:true}).waitFor();assert.equal(await p.getByLabel('JSON Pointer',{exact:true}).inputValue(),'/empty');
      await p.getByText('请检查业务结果',{exact:true}).waitFor();await t.shot('JSON 树与路径复制');
      await p.getByRole('button',{name:'展开 /list',exact:true}).click();assert.equal(await p.locator('.ro-api__jsonRow').count(),500);
      await p.getByRole('button',{name:'显示更多节点',exact:true}).click();assert.equal(await p.locator('.ro-api__jsonRow').count(),1000);
      await p.getByRole('button',{name:'折叠 /list',exact:true}).click();
      await p.getByLabel('API 请求路径',{exact:true}).fill('unsent-draft');await tab('网页').click();await tab('API').click();assert.equal(await p.getByLabel('API 请求路径',{exact:true}).inputValue(),'unsent-draft');
      assert.equal(await p.getByRole('button',{name:'折叠 /a~0~1b/0',exact:true}).isVisible(),true);
      await p.getByRole('button',{name:'环境管理',exact:true}).click();assert.equal(await p.getByRole('tablist',{name:'环境类型'}).getByRole('tab',{name:'API',exact:true}).getAttribute('aria-selected'),'true');
      await p.getByRole('button',{name:'返回工作区',exact:true}).click();assert.equal(await p.getByLabel('API 请求路径',{exact:true}).inputValue(),'unsent-draft');
    });
    await t.step('网页在后台继续执行，隐藏时不再请求画面，失败提示保留至查看',async()=>{
      await tab('网页').click();await p.getByRole('button',{name:'设置',exact:true}).click();await p.getByLabel('浏览器引擎',{exact:true}).selectOption('chrome');await p.getByRole('button',{name:'返回工作区',exact:true}).click();
      await p.getByLabel('网页地址',{exact:true}).fill(info.website.url+'/manual');await p.getByRole('button',{name:'打开网页',exact:true}).click();await p.getByAltText('网页实时画面',{exact:true}).waitFor();
      await p.getByLabel('网页地址',{exact:true}).evaluate(node=>{window.__layoutAddress=node;});
      await tool('remote_browser_run',{requestId:'badge-wait',steps:[{action:'wait',target:{kind:'css',value:'#never'},timeoutMs:7000}]});
      await tab('终端').click();let frames=0;const track=request=>{if(request.url().includes('/browser/frame?'))frames++;};p.on('request',track);
      await until(async()=>/执行中/.test(await tab('网页').innerText()));assert.equal(frames,0);await t.shot('网页后台操作徽标');
      await until(async()=>/待检查/.test(await tab('网页').innerText()));await tab('网页').click();await until(async()=>!/待检查/.test(await tab('网页').innerText()));p.off('request',track);
      assert.equal(await p.getByLabel('网页地址',{exact:true}).evaluate(node=>node===window.__layoutAddress),true);
      await p.getByRole('button',{name:'操作记录',exact:true}).click();await p.locator('.dsh-remote-ops__webLogBottom').waitFor();assert.equal(await p.getByLabel('网页地址',{exact:true}).isVisible(),true);
    });
    await t.step('窄屏和暗色下 JSON 响应与设置可见，无横向溢出',async()=>{
      await p.setViewportSize({width:390,height:844});await p.emulateMedia({colorScheme:'dark'});await p.evaluate(()=>{document.documentElement.style.colorScheme='dark';});
      await tab('API').click();assert.ok(await p.locator('.dsh-remote-ops').evaluate(node=>node.scrollWidth-node.clientWidth)<=1);await t.shot('窄栏 JSON 响应');
    });
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}};
