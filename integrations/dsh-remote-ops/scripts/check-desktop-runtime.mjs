import {desktopRuntime} from '../lib/desktop-runtime.js';
import {readdir} from 'node:fs/promises';
const runtime=await desktopRuntime();
for(const name of ['RemoteOpsDesktop.exe','RemoteOpsDesktopWorker.exe','FlaUI.Core.dll','FlaUI.UIA3.dll','Interop.UIAutomationClient.dll']){
  if(!runtime.files.some(file=>file.name===name))throw new Error('Missing desktop runtime file: '+name);
}
const expected=new Set(['manifest.json',...runtime.files.map(file=>file.name)]);
for(const file of await readdir(new URL('../desktop/runtime/',import.meta.url)))if(!expected.has(file))throw new Error('Unexpected file in packaged desktop runtime: '+file);
console.log('Desktop runtime verified: '+runtime.id);
