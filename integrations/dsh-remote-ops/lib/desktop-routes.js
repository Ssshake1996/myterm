import { registerRuntimeFetch } from './hot-reload.js';
import { ownerId } from './common.js';
import { desktopError } from './desktop-transport.js';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export function registerDesktopRoutes(ctx,state) {
  const workspace=state.desktop;
  ctx.effect(()=>registerRuntimeFetch(ctx,state,{path:'/api/dsh-remote-ops/desktop',methods:['GET','POST'],requestBody:'buffered',fetch:async request=>{
    try {
      await state.ready;
      if(request.method==='GET'){
        const id=new URL(request.url).searchParams.get('sessionId'),agent=ctx.agents.get(id);
        return Response.json({...workspace.snapshot(agent?ownerId(agent):undefined),localAvailable:process.platform==='win32'},{headers});
      }
      const body=await request.json(),owner=ownerId(await state.resolveOwner(body.sessionId)),args=body.args??{};let result;
      if(body.action==='inspect')result=await workspace.inspect(args,request.signal);
      else if(body.action==='connect')result=await workspace.connect(owner,args,request.signal);
      else if(body.action==='observe')result=await workspace.observe(owner,args,request.signal);
      else if(body.action==='launch')result=await workspace.launch(owner,args,request.signal);
      else if(body.action==='act')result=await workspace.act(owner,args,request.signal);
      else if(body.action==='read')result=workspace.read(owner,args);
      else if(body.action==='select')result=workspace.select(owner,args.desktopId);
      else if(body.action==='disconnect')result=await workspace.disconnect(owner,args.desktopId);
      else if(body.action==='export')result=await workspace.export(owner,args);
      else throw desktopError('DESKTOP_ACTION_INVALID','Unknown desktop action');
      return Response.json(result,{headers});
    }catch(error){return Response.json({code:error.code??'DESKTOP_OPERATION_FAILED',error:error.message},{status:400,headers});}
  }}),'dsh-remote-ops desktop route');
  ctx.effect(()=>registerRuntimeFetch(ctx,state,{path:'/api/dsh-remote-ops/desktop-log',methods:['GET'],requestBody:'buffered',fetch:async request=>{
    try{const params=new URL(request.url).searchParams,agent=ctx.agents.get(params.get('sessionId')),entry=workspace.exports.get(params.get('exportId'));
      if(!agent||!entry||entry.owner!==ownerId(agent))throw desktopError('DESKTOP_EXPORT_NOT_FOUND','Export is unavailable in this conversation');
      return new Response(entry.data,{headers:{...headers,'Content-Type':'application/zip','Content-Length':String(entry.data.length),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`}});
    }catch(error){return Response.json({code:error.code,error:error.message},{status:404,headers});}
  }}),'dsh-remote-ops desktop logs');
}
