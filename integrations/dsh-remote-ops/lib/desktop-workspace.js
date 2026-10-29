import { randomUUID, createHash } from 'node:crypto';
import { connectDesktop, desktopError } from './desktop-transport.js';
import { zipLogs } from './log-archive.js';

const invalid=message=>{throw desktopError('DESKTOP_ARGUMENT_INVALID',message+'; nothing was dispatched');};
const bounded=(value,name,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))invalid(`${name} must be a nonempty string up to ${max} characters`);return value;};
const only=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('Expected an object');for(const key of Object.keys(value))if(!keys.includes(key))invalid(`Unknown field: ${key}`);};
export function validateLaunch(args) {
  const path=bounded(args.path,'path',4096);
  if(!/^(?:[a-z]:[\\/]|\\\\)[^\0\r\n]+\.exe$/i.test(path))invalid('path must be an absolute Windows .exe path');
  if(args.args!=null&&(!Array.isArray(args.args)||args.args.length>64||args.args.some(v=>typeof v!=='string'||v.includes('\0')||v.length>8192)))invalid('args must be an array of strings');
  const workingDirectory=args.workingDirectory==null?undefined:bounded(args.workingDirectory,'workingDirectory',4096);
  return {path,args:args.args??[],...(workingDirectory?{workingDirectory}:{})};
}
export function validateDesktopAction(args) {
  const requestId=bounded(args.requestId,'requestId',100),snapshotId=bounded(args.snapshotId,'snapshotId',100);
  if(!Array.isArray(args.steps)||args.steps.length<1||args.steps.length>10)invalid('steps must be an array of 1–10 action objects');
  const steps=args.steps.map(step=>{
    only(step,['action','ref','text','keys','x','y','delta','checked']);
    if(!['click','fill','select','toggle','expect','keys','text','scroll'].includes(step.action))invalid('Unsupported desktop action');
    const allowed={click:['ref','x','y'],fill:['ref','text'],select:['ref'],toggle:['ref','checked'],expect:['ref','text'],keys:['ref','keys'],text:['ref','text'],scroll:['ref','delta']}[step.action];
    for(const key of Object.keys(step))if(key!=='action'&&!allowed.includes(key))invalid(`${step.action} does not accept ${key}`);
    if(['fill','select','toggle','expect'].includes(step.action)||step.ref!=null)bounded(step.ref,'ref',100);
    if(['fill','text','expect'].includes(step.action)&&(typeof step.text!=='string'||step.text.length>16384||step.text.includes('\0')))invalid('text must be a string up to 16384 characters; empty text clears a field');
    if(step.action==='keys'&&(typeof step.keys!=='string'||!/^(?:(?:CTRL|ALT|SHIFT)\+){0,3}(?:[A-Z0-9]|ENTER|TAB|ESC|BACKSPACE|DELETE|HOME|END|LEFT|UP|RIGHT|DOWN|SPACE)$/i.test(step.keys)))invalid('keys must be a supported chord such as CTRL+S or ENTER');
    if(step.action==='toggle'&&typeof step.checked!=='boolean')invalid('checked must be a boolean');
    if(step.action==='click'&&!step.ref&&(!Number.isInteger(step.x)||!Number.isInteger(step.y)||step.x<0||step.y<0||step.x>10000||step.y>10000))invalid('click needs ref, or integer window-relative x and y');
    if(step.action==='scroll'&&(!Number.isInteger(step.delta)||!step.delta||Math.abs(step.delta)>1200))invalid('delta must be a nonzero integer between -1200 and 1200');
    return {...step};
  });
  return {requestId,snapshotId,steps};
}

export class DesktopWorkspace {
  constructor(state,{connect=connectDesktop}={}) {
    this.state=state;this.connector=connect;this.sessions=new Map();this.selected=new Map();this.openings=new Map();this.active=0;this.exports=new Map();
  }
  async inspect(args,signal){return this.connector(this.state,{...args,signal,inspect:true});}
  async connect(owner,args,signal) {
    bounded(args.environment,'environment');
    const existing=[...this.sessions.values()].find(r=>r.owner===owner&&r.environment===args.environment&&!r.transport.closed&&(args.windowsSessionId==null||r.info.sessionId===args.windowsSessionId));
    if(existing){this.selected.set(owner,existing.id);return this.publicSession(existing);}
    if([...this.sessions.values()].filter(s=>s.owner===owner).length>=8)throw desktopError('DESKTOP_SESSION_LIMIT','Close an unused desktop connection first');
    const key=owner+'|'+args.environment+'|'+(args.windowsSessionId??'auto');
    if(this.openings.has(key))return this.openings.get(key);
    const pending=(async()=>{
      const transport=await this.connector(this.state,{...args,signal});
      if(signal?.aborted){transport.close();throw signal.reason;}
      const record={id:randomUUID(),owner,environment:args.environment,info:transport.info,transport,receipts:new Map(),events:[],busy:0,createdAt:new Date().toISOString()};
      this.sessions.set(record.id,record);this.selected.set(owner,record.id);this.record(record,'connected',{sessionId:record.info.sessionId});return this.publicSession(record);
    })();this.openings.set(key,pending);
    try{return await pending;}finally{this.openings.delete(key);}
  }
  session(owner,id){const record=this.sessions.get(id??this.selected.get(owner));if(!record||record.owner!==owner)throw desktopError('DESKTOP_SESSION_NOT_FOUND','Use the desktopId returned in this conversation');return record;}
  publicSession(r){return {desktopId:r.id,environment:r.environment,info:r.info,status:r.transport.closed?'disconnected':r.busy?'busy':'connected',createdAt:r.createdAt,error:r.error??null,lastAction:r.events.at(-1)??null};}
  snapshot(owner){return {selected:this.selected.get(owner)??null,sessions:[...this.sessions.values()].filter(r=>r.owner===owner).map(r=>this.publicSession(r))};}
  record(r,event,details={}){r.events.push({at:new Date().toISOString(),event,...details});if(r.events.length>1000)r.events.shift();}
  async observe(owner,args,signal){signal?.throwIfAborted();const r=this.session(owner,args.desktopId);this.active++;
    try{const value=await r.transport.call('observe',{...(args.windowId?{windowId:args.windowId}:{}),...(args.pid?{pid:args.pid}:{})});r.observation=value;r.error=null;return {...value,desktopId:r.id};}
    catch(error){r.error={code:error.code,message:error.message};throw error;}finally{this.active--;}
  }
  async once(r,requestId,body,work){
    const hash=JSON.stringify(body),previous=r.receipts.get(requestId);
    if(previous){if(previous.hash!==hash)throw desktopError('DESKTOP_REQUEST_CONFLICT','This requestId already identifies a different action');return previous.promise;}
    if(r.receipts.size>=500)throw desktopError('DESKTOP_REQUEST_LIMIT','Disconnect this idle desktop connection before starting another batch');
    const entry={hash};r.receipts.set(requestId,entry);
    entry.promise=(async()=>{r.busy++;this.active++;try{return await work();}finally{r.busy--;this.active--;}})();return entry.promise;
  }
  async launch(owner,args,signal){const normalized=validateLaunch(args),requestId=bounded(args.requestId,'requestId',100),r=this.session(owner,args.desktopId);
    return this.once(r,requestId,{launch:normalized},async()=>{signal?.throwIfAborted();this.record(r,'launch',{path:normalized.path});const result=await r.transport.call('launch',{...normalized,requestId:r.id+':'+requestId});this.record(r,'launched',{pid:result.pid});return {...result,desktopId:r.id};});
  }
  async act(owner,args,signal){const normalized=validateDesktopAction(args),r=this.session(owner,args.desktopId);
    return this.once(r,normalized.requestId,normalized,async()=>{
      const results=[];let status='completed';
      for(const [index,step] of normalized.steps.entries()){
        if(signal?.aborted){status='cancelled';break;}
        this.record(r,'action',{requestId:normalized.requestId,index,action:step.action,ref:step.ref??null,characters:step.text?.length});
        try{const result=await r.transport.call('act',{snapshotId:normalized.snapshotId,step,requestId:r.id+':'+normalized.requestId+':'+index});results.push(result);this.record(r,'result',{index,...result});}
        catch(error){status=error.code==='DESKTOP_OUTCOME_UNKNOWN'||r.transport.closed?'unknown':'failed';r.error={code:error.code,message:error.message};results.push({status,...r.error});this.record(r,'error',r.error);break;}
      }
      if(signal?.aborted)status='cancelled';
      return {desktopId:r.id,requestId:normalized.requestId,status,verified:status==='completed'&&results.at(-1)?.verified===true,results};
    });
  }
  read(owner,args){const r=this.session(owner,args.desktopId);return {...this.publicSession(r),events:r.events.slice(-100),observation:r.observation?{...r.observation,screenshot:undefined}:null};}
  async disconnect(owner,id){const r=this.session(owner,id);if(r.busy)throw desktopError('DESKTOP_BUSY','Stop the current DSH conversation and wait for its action to settle before disconnecting');r.transport.close();this.sessions.delete(r.id);if(this.selected.get(owner)===r.id)this.selected.delete(owner);return {disconnected:true,applicationsClosed:false};}
  async export(owner,{desktopId,all=false}={}){
    const records=all?[...this.sessions.values()].filter(s=>s.owner===owner):[this.session(owner,desktopId)];
    if(!records.length)throw desktopError('DESKTOP_LOGS_EMPTY','No desktop records in this conversation');
    const files=[];for(const r of records){files.push({name:`${r.id}/actions.json`,text:JSON.stringify({environment:r.environment,target:r.info,events:r.events},null,2)});if(r.observation?.screenshot?.data)files.push({name:`${r.id}/last-window.jpg`,text:Buffer.from(r.observation.screenshot.data,'base64')});}
    const data=await zipLogs(files),id=randomUUID(),filename='remote-ops-desktop-'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'.zip';
    while(this.exports.size>=16)this.exports.delete(this.exports.keys().next().value);this.exports.set(id,{owner,data,filename});
    return {exportId:id,filename,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),url:`/api/dsh-remote-ops/desktop-log?${new URLSearchParams({sessionId:owner,exportId:id})}`};
  }
  async dispose(){for(const r of this.sessions.values())r.transport.close();this.sessions.clear();this.exports.clear();}
}
