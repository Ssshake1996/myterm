import {desktopRuntime} from '../lib/desktop-transport.js';
const runtime=await desktopRuntime();
for(const name of ['RemoteOpsDesktop.exe','RemoteOpsDesktopWorker.exe','FlaUI.Core.dll','FlaUI.UIA3.dll','Interop.UIAutomationClient.dll']){
  if(!runtime.files.some(file=>file.name===name))throw new Error('Missing desktop runtime file: '+name);
}
console.log('Desktop runtime verified: '+runtime.id);
