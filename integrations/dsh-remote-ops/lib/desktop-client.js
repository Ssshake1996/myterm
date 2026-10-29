export function desktopPoint(frame,rect,clientX,clientY) {
  if(!frame||!rect.width||!rect.height)return null;
  const scale=Math.min(rect.width/frame.width,rect.height/frame.height),width=frame.width*scale,height=frame.height*scale;
  const x=clientX-rect.left-(rect.width-width)/2,y=clientY-rect.top-(rect.height-height)/2;
  if(x<0||y<0||x>=width||y>=height)return null;
  return {x:Math.floor(x/width*frame.sourceWidth),y:Math.floor(y/height*frame.sourceHeight)};
}

export function createDesktopPanel(React,request) {
  const {createElement:h,useState,useRef,useEffect}=React;
  const id=()=>globalThis.crypto?.randomUUID?.()??'desktop-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const styles=`
    .dsh-remote-ops__desktop{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;padding:10px;gap:8px}
    .dsh-remote-ops__desktopBar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:none}
    .dsh-remote-ops__desktopBar select{min-width:0;max-width:100%;flex:1;padding:6px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit}
    .dsh-remote-ops__desktopCanvas{display:flex;align-items:center;justify-content:center;position:relative;flex:1;min-height:160px;min-width:0;overflow:hidden;background:#161c25;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:9px}
    .dsh-remote-ops__desktopCanvas:fullscreen{padding:16px;background:#161c25}
    .dsh-remote-ops__desktopCanvas img{width:100%;height:100%;object-fit:contain;outline:none;cursor:default}
    .dsh-remote-ops__desktopCanvas img:focus-visible{outline:2px solid #79a7ff;outline-offset:-2px}
    .dsh-remote-ops__desktopEmpty{max-width:320px;padding:28px;color:#aab8ca;text-align:center;line-height:1.7}
    .dsh-remote-ops__desktopEmpty strong{display:block;font-size:16px;color:#edf4ff;margin-bottom:9px}
    .dsh-remote-ops__desktopStatus{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary,#667085);min-height:20px}
    .dsh-remote-ops__desktopStatus span:last-child{margin-left:auto}
    .dsh-remote-ops__desktopDot{width:7px;height:7px;border-radius:50%;background:#8b95a4;flex:none}
    .dsh-remote-ops__desktopDot[data-state=connected]{background:#29a36a}.dsh-remote-ops__desktopDot[data-state=busy]{background:#db9d24}
    .dsh-remote-ops__desktopMessage{padding:8px 10px;border-left:3px solid #d79b36;background:var(--dsw-alias-bg-layer-1,#f7f9fb);white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto;font-size:12px}
    .dsh-remote-ops__desktopForm{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:8px}
    .dsh-remote-ops__desktopEntry{display:flex;gap:6px;align-items:center}.dsh-remote-ops__desktopEntry textarea{resize:none;height:34px;min-height:34px;flex:1}
    .dsh-remote-ops__desktopRecords{flex:none;max-height:160px;overflow:auto;font-size:12px}.dsh-remote-ops__desktopRecords summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#667085)}
    .dsh-remote-ops__desktopRecords ol{padding-left:20px}.dsh-remote-ops__desktopRecords li{padding:3px;overflow-wrap:anywhere}
  `;
  return function DesktopPanel({sessionId,environments=[],visible=true}) {
    const [state,setState]=useState({sessions:[],selected:null,localAvailable:true}),[environment,setEnvironment]=useState('local'),[windowsSession,setWindowsSession]=useState(''),[sessions,setSessions]=useState([]);
    const [observation,setObservation]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[showLaunch,setShowLaunch]=useState(false),[showConnect,setShowConnect]=useState(false),[path,setPath]=useState(''),[args,setArgs]=useState(''),[text,setText]=useState(''),[events,setEvents]=useState([]);
    const alive=useRef(true),busyRef=useRef(false),canvas=useRef(null),image=useRef(null),currentRef=useRef(),observationRef=useRef(),visibleRef=useRef(visible),refreshing=useRef(false),inputQueue=useRef(Promise.resolve()),queued=useRef(0);
    visibleRef.current=visible;observationRef.current=observation;
    const current=state.sessions.find(s=>s.desktopId===state.selected);currentRef.current=current;
    const post=(action,values={})=>request('/api/dsh-remote-ops/desktop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,action,args:values})});
    const refresh=async()=>{
      if(refreshing.current)return;refreshing.current=true;
      try {
        const next=await request('/api/dsh-remote-ops/desktop?'+new URLSearchParams({sessionId}));if(!alive.current)return;setState(next);if(!next.localAvailable)setEnvironment(previous=>previous==='local'?'':previous);
        const selected=next.sessions.find(s=>s.desktopId===next.selected);
        if(visibleRef.current&&selected?.status==='connected'&&!busyRef.current){let frame;try{frame=await post('observe',{desktopId:selected.desktopId,listOnly:!selected.target});}catch(cause){if(!/DESKTOP_WINDOW_NOT_FOUND/.test(cause.message))throw cause;frame=await post('observe',{desktopId:selected.desktopId,listOnly:true});frame.captureError='原窗口暂未就绪或已关闭，请从窗口列表选择。';}if(alive.current){setObservation(frame);setError(frame.captureError??'');}}
      }catch(cause){if(alive.current){setError(cause.message);setObservation(null);}}finally{refreshing.current=false;}
    };
    useEffect(()=>{alive.current=true;void refresh();const timer=setInterval(()=>void refresh(),1600);return()=>{alive.current=false;clearInterval(timer);};},[sessionId]);
    const run=async(work)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{return await work();}catch(cause){if(alive.current)setError(cause.message);return null;}finally{busyRef.current=false;if(alive.current){setBusy(false);void refresh();}}};
    const act=step=>{
      const intended=currentRef.current,seen=observationRef.current;if(!intended||!seen?.snapshotId)return Promise.resolve(null);
      if(queued.current>=8){setError('输入队列已满，请等待当前操作完成');return Promise.resolve(null);}queued.current++;
      const pending=inputQueue.current.then(async()=>{
        while(alive.current&&busyRef.current)await new Promise(resolve=>setTimeout(resolve,30));
        if(!alive.current||!visibleRef.current||currentRef.current?.desktopId!==intended.desktopId)return null;
        return run(async()=>{
          const snapshot=['keys','text'].includes(step.action)?await post('observe',{desktopId:intended.desktopId,windowId:seen.windowId}):seen;
          const result=await post('act',{desktopId:intended.desktopId,requestId:id(),snapshotId:snapshot.snapshotId,steps:[step]});
          if(result.status!=='completed')throw new Error(result.results?.at(-1)?.message??'操作未完成，请检查当前窗口');
          const next=await post('observe',{desktopId:intended.desktopId});if(alive.current){observationRef.current=next;setObservation(next);}return result;
        });
      }).finally(()=>{queued.current--;});inputQueue.current=pending.catch(()=>{});return pending;
    };
    const connect=()=>run(async()=>{const result=await post('connect',{environment,...(windowsSession?{windowsSessionId:Number(windowsSession)}:{})});setObservation(null);setSessions([]);setShowConnect(false);return result;});
    const inspect=()=>run(async()=>{const result=await post('inspect',{environment});setSessions(result.sessions??[]);if(result.sessions?.length===1)setWindowsSession(String(result.sessions[0].sessionId));});
    const keyboard=event=>{
      if(event.isComposing||event.key==='Process')return;
      const named={Enter:'ENTER',Tab:'TAB',Escape:'ESC',Backspace:'BACKSPACE',Delete:'DELETE',ArrowLeft:'LEFT',ArrowRight:'RIGHT',ArrowUp:'UP',ArrowDown:'DOWN',Home:'HOME',End:'END',' ':'SPACE'};
      const key=named[event.key]??(/^[a-z0-9]$/i.test(event.key)?event.key.toUpperCase():null);
      if(!key||['Control','Shift','Alt','Meta'].includes(event.key))return;
      if(!event.ctrlKey&&!event.altKey&&event.key.length===1)return;
      event.preventDefault();void act({action:'keys',keys:[event.ctrlKey?'CTRL':null,event.altKey?'ALT':null,event.shiftKey?'SHIFT':null,key].filter(Boolean).join('+')});
    };
    const imageData=current&&current.status!=='disconnected'?observation?.screenshot:null;
    const available=environments.filter(e=>e.platform==='windows');
    const openForm=showLaunch?h('form',{className:'dsh-remote-ops__desktopForm',onSubmit:event=>{event.preventDefault();void run(async()=>{const result=await post('launch',{desktopId:current.desktopId,requestId:id(),path,args:args===''?[]:args.split(/\r?\n/)});setShowLaunch(false);return result;});}},
      h('label',null,'程序路径',h('input',{'aria-label':'Windows 程序路径',value:path,onChange:e=>setPath(e.target.value),placeholder:'C:\\Program Files\\App\\App.exe',required:true})),
      h('label',null,'启动参数',h('textarea',{'aria-label':'Windows 启动参数',value:args,onChange:e=>setArgs(e.target.value),placeholder:'每行一个参数，保留其中的空格'})),
      h('div',{className:'dsh-remote-ops__desktopBar'},h('button',{type:'submit',disabled:busy},'打开'),h('button',{type:'button',onClick:()=>setShowLaunch(false)},'返回画面'))):null;
    return h('section',{className:'dsh-remote-ops__desktop','aria-label':'Windows 桌面'},h('style',null,styles),
      !current||showConnect?h(React.Fragment,null,
        h('div',{className:'dsh-remote-ops__desktopBar'},h('select',{'aria-label':'桌面环境',value:environment,onChange:e=>{setEnvironment(e.target.value);setSessions([]);setWindowsSession('');}},state.localAvailable?h('option',{value:'local'},'本机 Windows'):h('option',{value:''},'选择 Windows 环境'),available.map(e=>h('option',{key:e.id,value:e.id},e.name))),h('button',{disabled:busy||!environment,onClick:connect},busy?'连接中…':'连接桌面'),h('button',{disabled:busy||!environment,onClick:inspect},'检查会话')),
        sessions.length?h('select',{'aria-label':'Windows 登录会话',value:windowsSession,onChange:e=>setWindowsSession(e.target.value)},h('option',{value:''},'选择登录会话'),sessions.map(s=>h('option',{key:s.sessionId,value:s.sessionId,disabled:s.state!=='active'},`${s.user} · 会话 ${s.sessionId} · ${s.state}`))):null):
      h('div',{className:'dsh-remote-ops__desktopBar'},
        state.sessions.length>1?h('select',{'aria-label':'桌面连接',value:state.selected,onChange:e=>void run(async()=>{await post('select',{desktopId:e.target.value});setObservation(null);})},state.sessions.map(s=>h('option',{key:s.desktopId,value:s.desktopId},s.environment+' · '+s.info.sessionId))):null,
        h('select',{'aria-label':'桌面窗口',value:observation?.windowId??'',onChange:e=>void run(async()=>{const frame=await post('observe',{desktopId:current.desktopId,windowId:e.target.value});setObservation(frame);})},h('option',{value:''},'选择软件窗口'),(observation?.windows??[]).map(w=>h('option',{key:w.windowId,value:w.windowId},w.title))),
        h('button',{disabled:busy||current.status==='disconnected',onClick:()=>setShowLaunch(v=>!v)},'打开应用'),h('button',{disabled:!imageData,onClick:()=>canvas.current?.requestFullscreen?.()},'全屏'),
        h('details',null,h('summary',null,'更多'),h('div',{className:'dsh-remote-ops__desktopBar'},h('button',{onClick:()=>setShowConnect(true)},'连接其他环境'),h('button',{onClick:()=>void run(async()=>{const result=await post('export',{all:true});const link=document.createElement('a');link.href=result.url;link.download=result.filename;link.click();})},'导出本会话桌面日志'),h('button',{disabled:busy||current.status==='busy',onClick:()=>void run(async()=>{await post('disconnect',{desktopId:current.desktopId});setObservation(null);})},'断开连接')))),
      error?h('div',{className:'dsh-remote-ops__desktopMessage',role:'status'},error):null,openForm,
      h('div',{className:'dsh-remote-ops__desktopCanvas',ref:canvas},imageData?h('img',{ref:image,src:'data:'+imageData.mimeType+';base64,'+imageData.data,alt:'目标 Windows 软件窗口',tabIndex:0,onKeyDown:keyboard,onClick:event=>{const point=desktopPoint(imageData,event.currentTarget.getBoundingClientRect(),event.clientX,event.clientY);if(point){event.currentTarget.focus({preventScroll:true});void act({action:'click',...point});}}}):h('div',{className:'dsh-remote-ops__desktopEmpty'},h('strong',null,current?'选择窗口，开始操作':'操作真实的 Windows 软件'),current?'从上方选择已打开的软件，或打开应用。':'连接已登录、解锁的桌面。首次连接会部署随包执行器；你与 Agent 共享同一个窗口。')),
      current&&imageData?h('form',{className:'dsh-remote-ops__desktopEntry',onSubmit:event=>{event.preventDefault();if(text)void act({action:'text',text}).then(result=>{if(result)setText('');});}},h('textarea',{'aria-label':'桌面输入内容',value:text,onChange:e=>setText(e.target.value),placeholder:'输入文字，点击发送到窗口',onCompositionStart:()=>{},onKeyDown:e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form.requestSubmit();}}}),h('button',{type:'submit',disabled:busy||!text},'发送'),h('button',{type:'button',disabled:busy,onClick:()=>void act({action:'keys',keys:'ENTER'})},'Enter')):null,
      h('div',{className:'dsh-remote-ops__desktopStatus',role:'status'},h('i',{className:'dsh-remote-ops__desktopDot','data-state':busy?'busy':current?.status??'disconnected'}),h('span',null,current?`${current.info.user??''} · 会话 ${current.info.sessionId}`:'未连接'),h('span',null,busy||current?.status==='busy'?'正在操作':observation?.observedAt?'画面 '+new Date(observation.observedAt).toLocaleTimeString():'')),
      current?h('details',{className:'dsh-remote-ops__desktopRecords',onToggle:event=>{if(event.currentTarget.open)void post('read',{desktopId:current.desktopId}).then(result=>{if(alive.current)setEvents(result.events);}).catch(e=>setError(e.message));}},h('summary',null,'操作记录'),h('ol',null,events.map((event,index)=>h('li',{key:index},new Date(event.at).toLocaleTimeString()+' · '+(event.action??event.event)+(event.status?' · '+event.status:'')+(event.message?' · '+event.message:''))))):null);
  };
}
