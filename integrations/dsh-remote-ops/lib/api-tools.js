import { ownerId } from './common.js';
import { apiError } from './api-config.js';

const str = description => ({type:'string',description});
const obj = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});
const dict = description => ({type:'object',properties:{},additionalProperties:true,description:description+'; all values must be strings'});
const nullable = schema => ({oneOf:[schema,{type:'null'}]});
const optional = fields => Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,nullable(value)]));
const authFields={
  mode:{type:'string',enum:['none','token','cookie']},username:str('Login username'),passwordRef:str('Existing DSH credential reference; never the raw password'),
  loginPath:str('POST login path relative to baseUrl; e.g. login'),bodyFormat:{type:'string',enum:['json','form']},usernameField:str('Literal login body field; default username'),passwordField:str('Literal login body field; default password'),
  extraBody:{type:'object',properties:{},additionalProperties:true,description:'Additional non-secret login fields'},
  tokenSource:{type:'string',enum:['body','header']},tokenPointer:str('JSON Pointer, e.g. /data/token (default /token)'),tokenResponseHeader:str('Response header containing the token'),headerName:str('Outgoing token header (default Authorization)'),prefix:str('Outgoing token prefix (default Bearer plus one space; empty for raw token)'),
  cookieName:str('Required session cookie name; empty accepts any cookie'),csrfCookie:str('Cookie whose value goes into the CSRF header'),csrfHeader:str('Outgoing CSRF header (default x-csrf-token)'),successPointer:str('Optional JSON Pointer to login success flag'),successValue:{oneOf:[{type:'string'},{type:'boolean'},{type:'number'}]},
};
export const API_ENVIRONMENT_FIELDS={
  name:str('Environment name, unique inside its group'),group:str('Group; default default'),baseUrl:str('Absolute HTTP(S) base URL, including API prefix, without credentials/query'),sshEnvironmentId:str('Optional existing SSH environment ID for the same device; no automatic SSH credential sharing'),
  headers:dict('Non-secret common headers'),headerRefs:dict('Header name to existing DSH credential reference, e.g. X-Api-Key'),timeoutMs:{type:'integer',description:'100–120000 milliseconds; default 30000'},caPem:str('Optional trusted CA PEM; normal TLS validation is always enabled'),auth:obj(optional(authFields)),
};
const environment=str('Exact API environment ID returned by remote_api_environment_list; never an SSH ID or a guessed name');
const requestId=str('Unique operation ID (1–120 chars). Identical ID/arguments return the retained receipt, never replay. Last 100 receipts per conversation, current DSH process only.');
const body={oneOf:[{type:'object',properties:{},additionalProperties:true},{type:'array',items:{oneOf:[{type:'object',properties:{},additionalProperties:true},{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]}},{type:'string'},{type:'null'}]};
export const API_TOOL_SCHEMAS={
  remote_api_environment_list:obj({}),
  remote_api_environment_save:obj({id:nullable(str('Omit to create; exact API environment ID to update. Omitted/null fields keep previous values.')), ...optional(API_ENVIRONMENT_FIELDS)}),
  remote_api_environment_delete:obj({environment},['environment']),
  remote_api_login:obj({environment,requestId},['environment','requestId']),
  remote_api_request:obj({environment,requestId,path:str('Relative to base URL; /items also preserves the base prefix. Absolute URLs and ../ are rejected.'),method:nullable({type:'string',enum:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']}),headers:nullable(dict('Non-secret request headers; auth is injected from the environment')),body},['environment','requestId','path']),
  remote_api_records:obj({requestId:nullable(str('Omit to list summaries; pass an exact requestId for redacted response details'))}),
};
export function registerApiTools(ctx,state) {
  const workspace=state.api;
  const definitions=[
    ['remote_api_environment_list','List saved RESTful environments and login state for this conversation. Read remote-ops-api skill for login/request examples.',async(_args,owner)=>workspace.snapshot(owner)],
    ['remote_api_environment_save','Create/update a saved RESTful environment. Create requires name/baseUrl. Supports username/password login to Token or Cookie. Password must be a DSH credential reference; user can enter it in the API environment editor. No HTTP request is sent.',async(args)=>{const clean=Object.fromEntries(Object.entries(args).filter(([,v])=>v!=null));if(clean.sshEnvironmentId&&!state.findEnvironment(clean.sshEnvironmentId))throw apiError('API_SSH_ENV_NOT_FOUND','Linked SSH environment does not exist');return {environment:await workspace.save(clean)};}],
    ['remote_api_environment_delete','Delete an API environment configuration and invalidate its login sessions. Credentials and retained request records remain.',async args=>workspace.remove(args.environment)],
    ['remote_api_login','POST the configured username/password login, retain Token/Cookie only in this conversation and DSH process. Returns a redacted receipt, never credentials. Does not dispatch a business request or automatically retry.',(args,owner,exec)=>workspace.login(owner,args,{signal:exec.signal})],
    ['remote_api_request','Execute one HTTP request from the DSH host against an exact saved API environment. Login first when required. Returns HTTP status, duration and redacted response. No automatic redirects, login retry or request replay. state=unknown means the device may have applied the operation; verify with a read-only request before any retry.',(args,owner,exec)=>workspace.request(owner,args,{signal:exec.signal})],
    ['remote_api_records','Read current-conversation API execution records, including requests started in the UI. A specific requestId returns response details. Records are bounded to the last 100 and are lost on DSH restart.',async(args,owner)=>args.requestId?workspace.read(owner,args.requestId):{records:workspace.snapshot(owner).records}],
  ];
  for(const [name,description,execute]of definitions)ctx.tools.register({name,description,parameters:API_TOOL_SCHEMAS[name],output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async(args,exec)=>{await workspace.ready;return execute(args,ownerId(exec.agent),exec);}});
}
