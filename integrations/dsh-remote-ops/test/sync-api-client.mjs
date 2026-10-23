import {readFileSync,writeFileSync} from 'node:fs';
const clientUrl=new URL('../lib/client.js',import.meta.url);
const api=readFileSync(new URL('../lib/api-client.js',import.meta.url),'utf8').replace(/^export /gm,'');
const start='    // BEGIN generated API client',end='    // END generated API client';
const block=start+'\n'+api.split('\n').map(line=>line?'    '+line:'').join('\n')+'\n    const ApiWorkspacePanel = createApiPanel(React, request);\n'+end;
const current=readFileSync(clientUrl,'utf8');
const from=current.indexOf(start),to=current.indexOf(end);
if(from<0||to<from)throw Error('API client generation markers missing');
const next=current.slice(0,from)+block+current.slice(to+end.length);
if(process.argv.includes('--check')){if(next!==current)throw Error('API client is stale; run node test/sync-api-client.mjs');}
else writeFileSync(clientUrl,next);
