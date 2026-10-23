import { ownerId } from './common.js';
import { apiError } from './api-config.js';

export function registerApiRoutes(ctx,state) {
  const workspace=state.api,headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  ctx.effect(()=>ctx.connection.fetch.register({path:'/api/dsh-remote-ops/api',methods:['GET','POST'],requestBody:'buffered',fetch:async request=>{
    try {
      await workspace.ready;
      if(request.method==='GET') {const url=new URL(request.url),agent=ctx.agents.get(url.searchParams.get('sessionId'));const owner=agent?ownerId(agent):undefined;if(url.searchParams.has('requestId'))return Response.json(workspace.read(owner,url.searchParams.get('requestId')),{headers});return Response.json({...workspace.snapshot(owner),bound:!!agent},{headers});}
      const body=await request.json();let result;
      if(body.action==='environment.save') {if(body.environment?.sshEnvironmentId&&!state.findEnvironment(body.environment.sshEnvironmentId))throw apiError('API_SSH_ENV_NOT_FOUND','Linked SSH environment does not exist');result=await workspace.save(body.environment,body.password);}
      else if(body.action==='environment.delete')result=await workspace.remove(body.environment);
      else {const owner=ownerId(await state.resolveOwner(body.sessionId));if(body.action==='login')result=await workspace.login(owner,body.args);else if(body.action==='request')result=await workspace.request(owner,body.args);else throw apiError('API_ACTION_INVALID','Unknown API action');}
      return Response.json({ok:true,result},{headers});
    }catch(error){return Response.json({code:error.code??'API_OPERATION_FAILED',error:error.code?.startsWith('API_')?error.message:'API operation failed; check configuration and DSH credentials'},{status:400,headers});}
  }}),'dsh-remote-ops API route');
}
