import { randomUUID } from 'node:crypto';

export const apiError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
export const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const sensitive = key => /password|passwd|secret|token|authorization|cookie|api[-_]?key|credential/i.test(key);
const hasSecretField = value => object(value) ? Object.entries(value).some(([key,val])=>sensitive(key)||hasSecretField(val)) : Array.isArray(value) && value.some(hasSecretField);
export const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const fail = message => { throw apiError('API_CONFIG_INVALID', message); };
const authFields = ['mode','username','passwordRef','loginPath','bodyFormat','usernameField','passwordField','extraBody','tokenSource','tokenPointer','tokenResponseHeader','headerName','prefix','cookieName','csrfCookie','csrfHeader','successPointer','successValue'];
const configFields = ['id','name','group','baseUrl','sshEnvironmentId','headers','headerRefs','timeoutMs','caPem','auth'];
const forbiddenHeaders = /^(host|connection|content-length|transfer-encoding|proxy-.*|upgrade|expect|accept-encoding|authorization|cookie|set-cookie)$/i;
export function headersMap(value, { refs = false } = {}) {
  if (!object(value) || Object.keys(value).length > 64) fail('headers must be an object with at most 64 entries');
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || forbiddenHeaders.test(key) || (!refs && sensitive(key))) fail('Use managed authentication or headerRefs for secret headers; transport headers cannot be overridden');
    if (typeof val !== 'string' || /[\r\n\0]/.test(val) || val.length > 8192 || (refs && !/^[A-Z_][A-Z0-9_]*$/.test(val))) fail('Invalid header value or credential reference');
    if (Object.hasOwn(result,key.toLowerCase())) fail('Duplicate header name');
    result[key.toLowerCase()] = val;
  }
  return result;
}
export function endpoint(baseUrl, path) {
  if (typeof path !== 'string' || !path || path.length > 8192 || /[\\#\r\n\0]/.test(path) || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) throw apiError('API_PATH_INVALID','Use a relative path under the environment base URL');
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  let decoded; try { decoded = decodeURIComponent(path.split('?')[0]); } catch { throw apiError('API_PATH_INVALID','Invalid URL encoding'); }
  if (decoded.split('/').some(part => part === '..' || part === '.') || /[\\\0]/.test(decoded)) throw apiError('API_PATH_INVALID','Path traversal is not allowed');
  const url = new URL(path.replace(/^\//,''), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw apiError('API_PATH_INVALID','Request must stay under the base URL');
  return url;
}
export function normalizeApiConfig(input, previous) {
  if (!object(input)) fail('environment must be an object');
  for (const key of Object.keys(input)) if (!configFields.includes(key)) fail(`Unknown environment field: ${key}`);
  const patch = Object.fromEntries(Object.entries(input).filter(([,v])=>v != null));
  const value = { id: previous?.id ?? ('api-' + randomUUID()), name:'', group:'default', baseUrl:'', sshEnvironmentId:'', headers:{}, headerRefs:{}, timeoutMs:30000, caPem:'', ...previous, ...patch };
  if (previous && value.id !== previous.id) fail('Environment identity cannot change');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)) fail('Invalid environment ID');
  for (const key of ['name','group','baseUrl','sshEnvironmentId','caPem']) if (typeof value[key] !== 'string') fail(`${key} must be a string`);
  value.name=value.name.trim(); value.group=value.group.trim()||'default';
  if (!value.name || value.name.length>120 || value.group.length>120 || value.sshEnvironmentId.length>200) fail('Environment name/group is invalid');
  let url; try { url=new URL(value.baseUrl); } catch { fail('baseUrl must be an HTTP(S) URL'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('baseUrl must be HTTP(S), without credentials, query or fragment');
  value.baseUrl=url.href.replace(/\/$/,'');
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs<100 || value.timeoutMs>120000) fail('timeoutMs must be an integer from 100 to 120000');
  if (value.caPem.length>131072 || (value.caPem && !value.caPem.includes('-----BEGIN CERTIFICATE-----'))) fail('caPem must contain a PEM CA certificate');
  value.headers=headersMap(value.headers); value.headerRefs=headersMap(value.headerRefs,{refs:true});
  if (patch.auth != null && !object(patch.auth)) fail('auth must be an object');
  for (const key of Object.keys(patch.auth??{})) if (!authFields.includes(key)) fail(`Unknown auth field: ${key}`);
  const authPatch=Object.fromEntries(Object.entries(patch.auth??{}).filter(([,v])=>v!=null));
  value.auth={mode:'none',username:'',passwordRef:'',loginPath:'login',bodyFormat:'json',usernameField:'username',passwordField:'password',extraBody:{},tokenSource:'body',tokenPointer:'/token',tokenResponseHeader:'x-auth-token',headerName:'Authorization',prefix:'Bearer ',cookieName:'',csrfCookie:'',csrfHeader:'x-csrf-token',successPointer:'',...previous?.auth,...authPatch};
  const auth=value.auth;
  if (!['none','token','cookie'].includes(auth.mode) || !['json','form'].includes(auth.bodyFormat) || !['body','header'].includes(auth.tokenSource)) fail('Unsupported auth mode, body format or token source');
  for (const key of authFields.filter(key=>!['extraBody','successValue'].includes(key))) if (typeof auth[key] !== 'string' || auth[key].length>8192 || /[\r\n\0]/.test(auth[key])) fail(`Invalid auth.${key}`);
  if (auth.passwordRef && !/^[A-Z_][A-Z0-9_]*$/.test(auth.passwordRef)) fail('Invalid passwordRef');
  if (!object(auth.extraBody) || JSON.stringify(auth.extraBody).length>32768 || hasSecretField(auth.extraBody)) fail('extraBody must be a small object without inline secrets');
  if (auth.mode !== 'none') {
    endpoint(value.baseUrl,auth.loginPath);
    if (!auth.usernameField || !auth.passwordField || auth.usernameField===auth.passwordField || [auth.usernameField,auth.passwordField].some(k=>['__proto__','constructor','prototype'].includes(k))) fail('Distinct credential field names are required');
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(auth.headerName) || /^(host|cookie|set-cookie|connection|content-length|transfer-encoding|proxy-.*)$/i.test(auth.headerName)) fail('Invalid token header');
    if (auth.mode==='token' && auth.tokenSource==='body' && !auth.tokenPointer.startsWith('/')) fail('tokenPointer uses JSON Pointer, e.g. /data/token');
    if (auth.csrfCookie && !/^[A-Za-z0-9_-]+$/.test(auth.csrfHeader)) fail('Invalid CSRF header');
    if (auth.successPointer && (!auth.successPointer.startsWith('/') || !Object.hasOwn(auth,'successValue'))) fail('successPointer needs an explicit successValue');
    if ([auth.headerName,auth.csrfHeader].some(name=>Object.hasOwn(value.headers,name.toLowerCase())||Object.hasOwn(value.headerRefs,name.toLowerCase()))) fail('Managed authentication headers cannot be overridden');
  }
  return value;
}
export function pointer(value, path) {
  if (!path.startsWith('/')) return undefined;
  for (const key of path.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'))) { if (!object(value) && !Array.isArray(value)) return undefined; value=Object.hasOwn(value,key)?value[key]:undefined; }
  return value;
}
export function redact(value, secrets = []) {
  if (Array.isArray(value)) return value.map(v=>redact(v,secrets));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key,val])=>[key,sensitive(key)?'[redacted]':redact(val,secrets)]));
  if (typeof value !== 'string') return value;
  let result=value;
  for (const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length)) result=result.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]');
  return result.replace(/((?:password|passwd|token|secret|api[_-]?key)=)[^&\s]*/gi,'$1[redacted]');
}
