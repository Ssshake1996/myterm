// Package integrity checks must also run before npm installs runtime dependencies.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const desktopRuntimeRoot=fileURLToPath(new URL('../desktop/runtime/',import.meta.url));
export const desktopError=(code,message)=>Object.assign(new Error(`${code}: ${message}`),{code});

export async function desktopRuntime() {
  const bytes=await readFile(join(desktopRuntimeRoot,'manifest.json')).catch(()=>{throw desktopError('DESKTOP_RUNTIME_MISSING','Install a plugin package containing the built Windows desktop runtime');});
  const manifest=JSON.parse(bytes);
  const names=['RemoteOpsDesktop.exe','RemoteOpsDesktopWorker.exe','RemoteOpsDesktop.exe.config','RemoteOpsDesktopWorker.exe.config','FlaUI.Core.dll','FlaUI.UIA3.dll','Interop.UIAutomationClient.dll','flaui.core-LICENSE.txt','flaui.uia3-LICENSE.txt','interop.uiautomationclient-LICENSE.txt'];
  if(manifest.protocol!==1||!Array.isArray(manifest.files)||manifest.files.length!==names.length||names.some(name=>manifest.files.filter(file=>file.name===name).length!==1))throw desktopError('DESKTOP_RUNTIME_INVALID','Runtime manifest must contain exactly the pinned binaries, configuration and licenses');
  for(const file of manifest.files) {
    if(!/^[\w.-]+$/.test(file.name))throw desktopError('DESKTOP_RUNTIME_INVALID','Invalid runtime filename');
    if(createHash('sha256').update(await readFile(join(desktopRuntimeRoot,file.name))).digest('hex')!==file.sha256)throw desktopError('DESKTOP_RUNTIME_INVALID',`Runtime checksum mismatch: ${file.name}`);
  }
  return {...manifest,id:createHash('sha256').update(bytes).digest('hex').slice(0,20)};
}
