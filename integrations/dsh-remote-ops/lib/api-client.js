// Inlined into the native plugin bundle by test/sync-api-client.mjs; no CDN or extra runtime.
const drafts = new Map();
export const statusLabel = value => ({running:'执行中',completed:'已完成',http_error:'HTTP 错误',failed:'失败',unknown:'结果未知'}[value]??value);
export const jsonPointerChild = (parent, key) => parent+'/'+String(key).replace(/~/g,'~0').replace(/\//g,'~1');
// Bound work as well as DOM size: a large array or deeply nested response stays inspectable.
export function jsonTreeRows(value, expanded, limit=500) {
  const rows=[], stack=[{value,pointer:'',label:'根节点',depth:0}];
  while(stack.length&&rows.length<limit) {
    const row=stack.pop(), container=row.value!==null&&typeof row.value==='object';
    const keys=container?Object.keys(row.value):[];
    rows.push({...row,container,count:keys.length,depthLimited:row.depth>=32});
    if(container&&expanded.has(row.pointer)&&row.depth<32) {
      // Queue at most the remaining budget plus one sentinel, even for very wide JSON.
      for(let i=Math.min(keys.length,limit-rows.length+1)-1;i>=0;i--) {
        const key=keys[i];stack.push({value:row.value[key],pointer:jsonPointerChild(row.pointer,key),label:key,depth:row.depth+1});
      }
    }
  }
  return {rows,more:stack.length>0};
}
export function createApiPanel(React, request, EnvironmentManager) {
  const {createElement:h,useState,useEffect,useCallback,useRef}=React;
  const style=`
    .ro-api{display:flex;flex-direction:column;gap:14px;padding:16px;min-width:0;height:100%;overflow:auto;box-sizing:border-box}
    .ro-api__bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ro-api__bar>select{flex:1;min-width:120px}.ro-api select{border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:7px;font:inherit;max-width:100%}
    .ro-api h2{font-size:21px;font-weight:600;letter-spacing:-.5px;margin:12px 0 8px}.ro-api p{color:var(--dsw-alias-label-secondary,#667085);margin:6px 0;line-height:1.7;font-size:12px}.ro-api__eyebrow{font-size:11px;letter-spacing:1.2px;color:var(--dsw-alias-label-secondary,#667085)}
    .ro-api__card{border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:10px;padding:12px;min-width:0}.ro-api header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.ro-api__endpoint{font:12px/1.6 ui-monospace,Consolas,monospace;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#667085)}
    .ro-api__badge{font-size:11px;padding:3px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,#f2f4f7);white-space:nowrap}.ro-api__badge[data-state=completed]{color:light-dark(#176b49,#80d7ad)}.ro-api__badge[data-state=unknown],.ro-api__badge[data-state=http_error],.ro-api__badge[data-state=failed]{color:var(--dsw-alias-state-error-primary,#b42318)}
    .ro-api .ro-api__primary{background:var(--ro-accent,#315cb5);color:white;border-color:transparent;padding:7px 13px}.ro-api__form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.ro-api label{display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px}.ro-api__wide{grid-column:1/-1}.ro-api textarea{resize:vertical;min-height:80px;font:12px/1.6 ui-monospace,Consolas,monospace}.ro-api__requestLine{display:flex;gap:7px}.ro-api__requestLine input{min-width:0;flex:1}.ro-api__requestLine select{flex:none;width:90px}
    .ro-api__history{display:flex;flex-direction:column;gap:3px;max-height:260px;overflow:auto}.ro-api .ro-api__row{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:7px;text-align:left;border:0;background:transparent;padding:9px 6px;border-radius:5px}.ro-api__row[aria-pressed=true]{outline:1px solid var(--ro-accent,#315cb5);outline-offset:-1px}.ro-api__row b{font-size:11px;color:var(--ro-accent,#315cb5)}.ro-api__row span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ro-api__row small{display:block;color:var(--dsw-alias-label-secondary,#667085);font-size:10px}
    .ro-api pre{margin:6px 0 0;padding:12px;border-radius:7px;background:var(--dsw-alias-bg-layer-1,#f6f8fa);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,Consolas,monospace;max-height:360px;overflow:auto}.ro-api details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#667085);padding:6px 0}.ro-api__error{padding:9px;border-left:3px solid var(--dsw-alias-state-error-primary,#b42318);color:var(--dsw-alias-state-error-primary,#b42318);overflow-wrap:anywhere}.ro-api__empty{padding:18px 0;color:var(--dsw-alias-label-secondary,#667085)}.ro-api__meta{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#667085)}

    .ro-api{padding:14px;gap:12px}.ro-api__work{display:flex;flex-direction:column;gap:12px}.ro-api__request{display:grid;gap:7px}.ro-api__requestLine{align-items:center}.ro-api__requestLine button{flex:none}.ro-api__bar>input{flex:1;min-width:120px;width:auto}.ro-api__results{border-top:1px solid var(--ro-border,#e7e9ee);padding-top:8px}.ro-api__resultTabs{display:flex;gap:18px;margin-bottom:12px}.ro-api__resultTabs>button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding-inline:0}.ro-api__resultTabs>button[aria-selected=true]{border-bottom-color:var(--ro-accent);color:var(--ro-accent)}.ro-api__history{max-height:none}.ro-api__http{padding:4px 8px;border-radius:5px;font:600 12px ui-monospace,Consolas,monospace}.ro-api__http[data-kind=ok]{color:light-dark(#166343,#8de2b7);background:light-dark(#e1f4e9,#153c2e)}.ro-api__http[data-kind=error]{color:light-dark(#9b231b,#ffb0a8);background:light-dark(#fce9e7,#4a2525)}.ro-api__http[data-kind=other]{background:var(--ro-soft)}.ro-api__businessNote{margin:0 0 8px!important}.ro-api__environment{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 0;border-bottom:1px solid var(--ro-border)}.ro-api__environment>div{flex:1;min-width:160px}.ro-api__environment small{display:block;overflow-wrap:anywhere;color:var(--ro-muted)}.ro-api__environment details[open]{flex-basis:100%}.ro-api__json{font:12px/1.6 ui-monospace,Consolas,monospace}.ro-api__jsonRow{display:flex;align-items:baseline;gap:5px;min-height:30px;border-bottom:1px solid color-mix(in srgb,var(--ro-border) 45%,transparent);overflow-wrap:anywhere}.ro-api .ro-api__jsonKey,.ro-api .ro-api__jsonToggle{border:0;background:transparent;padding:3px;min-height:28px;font:inherit}.ro-api__jsonKey{flex-shrink:1;min-width:0;text-align:left!important;overflow-wrap:anywhere;word-break:break-word;color:var(--ro-accent)!important}.ro-api .ro-api__jsonToggle,.ro-api__jsonSpacer{flex:none;display:inline-block;width:20px}.ro-api__jsonValue{flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word;color:var(--ro-muted)}.ro-api__jsonValue[data-type=string]{color:light-dark(#256b4d,#8dcfa9)}.ro-api__jsonValue[data-type=number],.ro-api__jsonValue[data-type=boolean]{color:light-dark(#79531b,#e6c27c)}.ro-api__pointer{display:grid;gap:5px;padding:8px;background:var(--ro-soft);border-radius:6px;margin-block:8px}.ro-api__pointer input{font:inherit}.ro-api__json p{font-family:inherit}
  `;
  function JsonResponse({value}) {
    const [expanded,setExpanded]=useState(()=>new Set([''])),[limit,setLimit]=useState(500),[copied,setCopied]=useState(null);
    const tree=jsonTreeRows(value,expanded,limit);
    const copy=async pointer=>{try{await navigator.clipboard.writeText(pointer);setCopied({pointer,ok:true});}catch{setCopied({pointer,ok:false});}};
    return h('div',{className:'ro-api__json'},h('p',null,'箭头展开 · 点击字段名复制 JSON Pointer'),
      copied?h('div',{className:'ro-api__pointer',role:'status'},copied.ok?'已复制路径':'无法自动复制，请选择下方路径复制',h('input',{'aria-label':'JSON Pointer',value:copied.pointer,readOnly:true,onFocus:e=>e.currentTarget.select()}),copied.pointer===''?h('small',null,'根节点的 JSON Pointer 是空字符串。'):null):null,
      tree.rows.map(row=>h('div',{key:row.pointer,className:'ro-api__jsonRow',style:{paddingInlineStart:Math.min(row.depth,12)*14+'px'}},
        row.container&&row.count&&!row.depthLimited?h('button',{type:'button',className:'ro-api__jsonToggle','aria-label':(expanded.has(row.pointer)?'折叠 ':'展开 ')+(row.pointer||'根节点'),'aria-expanded':expanded.has(row.pointer),onClick:()=>setExpanded(old=>{const next=new Set(old);next.has(row.pointer)?next.delete(row.pointer):next.add(row.pointer);return next;})},expanded.has(row.pointer)?'▾':'▸'):h('span',{className:'ro-api__jsonSpacer'}),
        h('button',{type:'button',className:'ro-api__jsonKey',title:row.pointer||'根节点（空路径）','aria-label':'复制 JSON Pointer '+(row.pointer||'根节点'),onClick:()=>void copy(row.pointer)},row.label===''?'""':row.label),
        h('span',{className:'ro-api__jsonValue','data-type':row.value===null?'null':typeof row.value},row.container?(Array.isArray(row.value)?'['+row.count+']':'{'+row.count+'}')+(row.depthLimited?' · 更深内容见原文':''):JSON.stringify(row.value)))),
      tree.more?h('div',null,h('p',null,'已显示 '+limit+' 个节点，可收起分支或查看原文。'),limit<2000?h('button',{type:'button',onClick:()=>setLimit(n=>Math.min(n+500,2000))},'显示更多节点'):null):null);
  }
  return function ApiPanel({sessionId,sshEnvironments=[],mode='workspace',onManage,onUse,askPanel}) {
    const [draft,setDraft]=useState(()=>drafts.get(sessionId)??{environment:'',method:'GET',path:'',body:'',headers:'{}'});
    const [data,setData]=useState({environments:[],sessions:[],records:[]});
    const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
    const manage=mode==='environments';
    const [form,setForm]=useState(null),[password,setPassword]=useState(''),[envSearch,setEnvSearch]=useState(''),[envGroup,setEnvGroup]=useState('');
    const [resultTab,setResultTab]=useState('response'),[responseFormat,setResponseFormat]=useState('tree');
    useEffect(()=>{if(!manage)setPassword('');},[manage]);
    const [detailId,setDetailId]=useState(''),[detail,setDetail]=useState(null),alive=useRef(true);
    const endpoint='/api/dsh-remote-ops/api',query='?sessionId='+encodeURIComponent(sessionId??'');
    const patch=values=>setDraft(current=>({...current,...values}));
    useEffect(()=>{drafts.set(sessionId,draft);if(drafts.size>50)drafts.delete(drafts.keys().next().value);},[sessionId,draft]);
    const refresh=useCallback(async()=>{try{const next=await request(endpoint+query);if(alive.current){setData(next);setLoading(false);}}catch(err){if(alive.current){setError(err.message);setLoading(false);}}},[query]);
    useEffect(()=>{alive.current=true;let timer;const tick=async()=>{await refresh();if(alive.current)timer=setTimeout(tick,1500);};void tick();return()=>{alive.current=false;clearTimeout(timer);};},[refresh]);
    useEffect(()=>{if(!draft.environment&&data.environments.length)patch({environment:data.environments[0].id});},[data.environments,draft.environment]);
    const detailRevision=JSON.stringify(data.records.find(r=>r.id===detailId));
    useEffect(()=>{let cancelled=false;if(!detailId){setDetail(null);return;}request(endpoint+query+'&requestId='+encodeURIComponent(detailId)).then(value=>{if(!cancelled)setDetail(value);}).catch(err=>{if(!cancelled)setError(err.message);});return()=>{cancelled=true;};},[detailId,detailRevision,query]);
    useEffect(()=>{if(!detailId&&data.records[0])setDetailId(data.records[0].id);},[detailId,data.records]);
    const selected=data.environments.find(env=>env.id===draft.environment),loggedIn=data.sessions.some(s=>s.environment===draft.environment);
    const post=async body=>{setBusy(true);setError('');try{const value=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,...body})});if(alive.current)await refresh();return value.result;}catch(err){if(alive.current)setError(err.message);return undefined;}finally{if(alive.current)setBusy(false);}};
    const edit=env=>{
      setError('');setPassword('');onManage?.();
      setForm(env?{...env,headersText:JSON.stringify(env.headers,null,2),advancedText:JSON.stringify({headerRefs:env.headerRefs,caPem:env.caPem,auth:Object.fromEntries(Object.entries(env.auth).filter(([k])=>!['mode','username','passwordRef','loginPath','bodyFormat','tokenPointer','cookieName'].includes(k)))},null,2)}:{name:'',group:envGroup||'default',baseUrl:'',sshEnvironmentId:'',timeoutMs:30000,auth:{mode:'token',username:'',passwordRef:'',loginPath:'login',bodyFormat:'json',tokenPointer:'/token',cookieName:''},headersText:'{}',advancedText:'{}'});
    };
    const field=(label,key,options={})=>h('label',{className:options.wide?'ro-api__wide':undefined},label,h('input',{...options,wide:undefined,'aria-label':label,value:form[key]??'',onChange:e=>setForm({...form,[key]:options.type==='number'?Number(e.target.value):e.target.value})}));
    const authField=(label,key,placeholder)=>h('label',null,label,h('input',{'aria-label':label,value:form.auth[key]??'',placeholder,onChange:e=>setForm({...form,auth:{...form.auth,[key]:e.target.value}})}));
    const button=(label,onClick,options={})=>h('button',{type:'button',onClick,...options},label);
    const textArea=(label,value,onChange,rows)=>h('label',null,label,h('textarea',{'aria-label':label,value,onChange:e=>onChange(e.target.value),rows}));
    const save=async event=>{event.preventDefault();try{
      const {headersText,advancedText,...base}=form,advanced=JSON.parse(advancedText);
      if(!advanced||typeof advanced!=='object'||Array.isArray(advanced)||Object.keys(advanced).some(k=>!['auth','headerRefs','caPem'].includes(k)))throw Error('高级配置仅支持 auth、headerRefs、caPem 对象字段');
      const environment={...base,...advanced,headers:JSON.parse(headersText),auth:{...base.auth,...advanced.auth}};
      const result=await post({action:'environment.save',environment,password});if(result&&alive.current){patch({environment:result.id});setForm(null);setPassword('');}
    }catch(err){setError(err.message);}};
    const execute=async kind=>{if(!selected)return;try{
      const args={environment:selected.id,requestId:(kind==='login'?'login-':'request-')+crypto.randomUUID()};
      if(kind!=='login'){args.method=draft.method;args.path=draft.path;args.headers=JSON.parse(draft.headers||'{}');if(draft.body.trim())args.body=JSON.parse(draft.body);}
      setResultTab('response');
      const result=await post({action:kind,args});if(result&&alive.current){setDetailId(result.id);setDetail(result);}
    }catch(err){setError('JSON 格式错误：'+err.message);}};
    const exportRecords=async()=>{setBusy(true);try{
      const records=await Promise.all(data.records.map(r=>request(endpoint+query+'&requestId='+encodeURIComponent(r.id))));
      const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='remote-ops-api-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){setError(err.message);}finally{if(alive.current)setBusy(false);}};
    const badge=(state,label)=>h('span',{className:'ro-api__badge','data-state':state},label??statusLabel(state));
    const formView=form?h('form',{className:'ro-api__card',onSubmit:save},
      h('header',null,h('strong',null,form.id?'编辑 API 环境':'新建 API 环境'),button('取消',()=>{setForm(null);setPassword('');})),
      h('div',{className:'ro-api__form'},field('API 环境名称','name',{required:true}),field('API 分组','group'),field('Base URL','baseUrl',{required:true,placeholder:'https://device.example/api/v1',wide:true}),
        h('label',null,'关联 SSH 环境（可选）',h('select',{'aria-label':'关联 SSH 环境',value:form.sshEnvironmentId,onChange:e=>setForm({...form,sshEnvironmentId:e.target.value})},h('option',{value:''},'独立 API 环境'),sshEnvironments.map(env=>h('option',{key:env.id,value:env.id},env.name)))),field('超时（毫秒）','timeoutMs',{type:'number',min:100,max:120000}),
        h('label',null,'认证方式',h('select',{'aria-label':'API 认证方式',value:form.auth.mode,onChange:e=>setForm({...form,auth:{...form.auth,mode:e.target.value}})},h('option',{value:'token'},'登录获取 Token'),h('option',{value:'cookie'},'登录获取 Cookie'),h('option',{value:'none'},'无需登录'))),
        form.auth.mode!=='none'?h(React.Fragment,null,authField('登录路径','loginPath','login'),authField('API 用户名','username'),h('label',null,'API 密码',h('input',{type:'password',autoComplete:'new-password','aria-label':'API 密码',value:password,onChange:e=>setPassword(e.target.value),placeholder:form.auth.passwordRef?'已配置；留空保持':'保存到 DSH 凭据'})),authField('密码凭据引用（可选）','passwordRef','已有 DSH 凭据名'),h('label',null,'登录格式',h('select',{'aria-label':'登录格式',value:form.auth.bodyFormat,onChange:e=>setForm({...form,auth:{...form.auth,bodyFormat:e.target.value}})},h('option',{value:'json'},'JSON'),h('option',{value:'form'},'Form'))),form.auth.mode==='token'?authField('Token JSON Pointer','tokenPointer','/data/token'):authField('Session Cookie 名称','cookieName','sid')):null,
        h('details',{className:'ro-api__wide'},h('summary',null,'请求头与高级登录配置'),textArea('API 公共请求头',form.headersText,value=>setForm({...form,headersText:value})),textArea('API 高级配置',form.advancedText,value=>setForm({...form,advancedText:value}),8),h('p',null,'支持 auth.usernameField / passwordField、tokenSource / tokenResponseHeader、headerName / prefix、successPointer / successValue、csrfCookie / csrfHeader，以及 headerRefs 和 caPem。'))),
      h('p',null,'配置修改后需重新登录。密码留空保留；Token 与 Cookie 仅在当前对话、本次 DSH 进程中保存。'),h('button',{className:'ro-api__primary',type:'submit',disabled:busy},busy?'保存中…':'保存 API 环境')):null;
    const responseBody=detail?.response&&Object.hasOwn(detail.response,'body')?detail.response.body:detail?.response;
    const httpBadge=code=>code?h('span',{className:'ro-api__http','data-kind':code>=200&&code<300?'ok':code>=400?'error':'other'},'HTTP '+code):null;
    return h('section',{className:'ro-api','aria-label':manage?'API 环境管理':'API 工作区'},h('style',null,style),
      error?h('div',{className:'ro-api__error',role:'alert'},error,button('刷新',()=>{setError('');void refresh();})):null,
      loading?h('div',{role:'status'},'正在读取 API 环境…'):null,
      h('div',{hidden:!manage},formView??h(EnvironmentManager,{
        kind:'api',environments:data.environments,groups:[...new Set(data.environments.map(env=>env.group))].sort(),search:envSearch,onSearch:setEnvSearch,group:envGroup,onGroup:setEnvGroup,busy,hidden:!manage,ask:askPanel,
        onCreate:()=>edit(),onEdit:edit,onPrimary:env=>{patch({environment:env.id});onUse?.();},primaryLabel:'使用',
        onDelete:async env=>{const value=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'environment.delete',environment:env.id,sessionId})});if(alive.current){await refresh();if(value.result?.deleted&&draft.environment===env.id)patch({environment:''});}return !!value.result?.deleted;},
        describe:env=>env.baseUrl+' · '+(env.auth.mode==='none'?'无需登录':data.sessions.some(session=>session.environment===env.id)?'已登录':'未登录'),
      })),
      h('div',{hidden:manage,className:'ro-api__work'},
        h('div',{className:'ro-api__bar'},h('select',{'aria-label':'API 环境',value:draft.environment,onChange:e=>patch({environment:e.target.value})},h('option',{value:''},'选择 API 环境'),data.environments.map(env=>h('option',{value:env.id,key:env.id},env.group+' / '+env.name))),selected?badge(loggedIn?'completed':'idle',selected.auth.mode==='none'?'无需登录':loggedIn?'已登录':'未登录'):null,selected&&selected.auth.mode!=='none'?button(loggedIn?'重新登录':'登录',()=>void execute('login'),{disabled:busy||!sessionId}):null),
        !loading&&!data.environments.length?h('div',{className:'ro-api__empty'},h('h2',null,'从一个 API 环境开始'),h('p',null,'保存地址与登录配置，Agent 和你共享请求过程与响应。'),button('新建 API 环境',()=>edit(),{className:'ro-api__primary'})):null,
        selected?h('div',{className:'ro-api__request'},h('div',{className:'ro-api__endpoint',title:'请求由 DSH 主机发送'},selected.baseUrl),
          h('div',{className:'ro-api__requestLine'},h('select',{'aria-label':'HTTP 方法',value:draft.method,onChange:e=>patch({method:e.target.value})},['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(method=>h('option',{key:method},method))),h('input',{'aria-label':'API 请求路径',value:draft.path,onChange:e=>patch({path:e.target.value}),placeholder:'volumes?limit=20',spellCheck:false}),button(busy?'执行中…':'发送',()=>void execute('request'),{'aria-label':'发送请求',className:'ro-api__primary',disabled:busy||!draft.path||!sessionId||(selected.auth.mode!=='none'&&!loggedIn)})),
          h('details',null,h('summary',null,'请求参数'),h('p',null,'路径基于上方 Base URL · 由 DSH 主机发送 · '+selected.timeoutMs/1000+'s 超时'),textArea('API 请求头',draft.headers,value=>patch({headers:value})),textArea('API 请求体',draft.body,value=>patch({body:value}))),!sessionId?h('p',null,'选择或新建对话后即可登录和执行。'):null):null,
        h('div',{className:'ro-api__results'},h('div',{className:'ro-api__resultTabs',role:'tablist','aria-label':'API 结果'},[['response','响应'],['history','记录']].map(([id,label],index)=>button(label,()=>setResultTab(id),{key:id,id:'api-result-tab-'+sessionId+'-'+id,role:'tab','aria-selected':resultTab===id,'aria-controls':'api-result-'+sessionId+'-'+id,tabIndex:resultTab===id?0:-1,onKeyDown:event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;setResultTab(next?'history':'response');event.currentTarget.parentElement.children[next]?.focus();}}}))),
          h('div',{hidden:resultTab!=='history',role:'tabpanel',id:'api-result-'+sessionId+'-history','aria-labelledby':'api-result-tab-'+sessionId+'-history'},h('header',null,h('small',null,'当前对话 · 最近 100 条'),button('导出记录',()=>void exportRecords(),{disabled:busy||!data.records.length})),h('div',{className:'ro-api__history'},data.records.map(record=>button(h(React.Fragment,null,h('b',null,record.kind==='login'?'LOGIN':record.method),h('span',null,record.path,h('small',null,record.environmentName+' · '+new Date(record.startedAt).toLocaleTimeString())),badge(record.state,(record.httpStatus?record.httpStatus+' · ':'')+statusLabel(record.state))),()=>{if(detailId!==record.id)setDetail(null);setDetailId(record.id);setResultTab('response');},{key:record.id,className:'ro-api__row','aria-pressed':detailId===record.id}))),!data.records.length?h('div',{className:'ro-api__empty'},'请求执行后会出现在这里。'):null,h('p',null,'DSH 重启后清空，可导出保存。')),
          h('div',{hidden:resultTab!=='response',role:'tabpanel',id:'api-result-'+sessionId+'-response','aria-labelledby':'api-result-tab-'+sessionId+'-response'},detail?h('div',{'aria-label':'API 响应详情'},
            h('header',null,h('div',{className:'ro-api__bar'},httpBadge(detail.httpStatus),badge(detail.state),h('small',null,(detail.durationMs??0)+' ms')),responseBody!==undefined?h('select',{'aria-label':'响应格式',value:responseFormat,onChange:e=>setResponseFormat(e.target.value)},h('option',{value:'tree'},'JSON 树'),h('option',{value:'raw'},'原文')):null),
            detail.httpStatus>=200&&detail.httpStatus<300?h('p',{className:'ro-api__businessNote'},'请检查业务结果'):null,
            h('div',{className:'ro-api__meta'},detail.id),detail.note?h('div',{className:'ro-api__error'},detail.state==='unknown'?'结果未知：设备可能已执行。请先查询设备状态，不要直接重复下发。':detail.note):null,detail.error?h('p',null,detail.error):null,
            detail.truncated?h('p',null,'响应已截断（128 KiB），请使用接口分页获取更多内容。'):null,
            responseBody===undefined?h('p',null,'尚无响应内容'):responseFormat==='tree'&&typeof responseBody!=='string'?h(JsonResponse,{key:detail.id,value:responseBody}):h('pre',null,typeof responseBody==='string'?responseBody:JSON.stringify(responseBody,null,2)),
            detail.response?.headers?h('details',null,h('summary',null,'响应头'),h('pre',null,JSON.stringify(detail.response.headers,null,2))):null,h('details',null,h('summary',null,'请求详情（已脱敏）'),h('pre',null,JSON.stringify({url:detail.url,method:detail.method,...detail.request},null,2)))):h('div',{className:'ro-api__empty'},'发送请求，或在记录中选择一次执行。')))));
  };
}
