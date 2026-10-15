import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsDefaultBrowser } from '../lib/browser-default.js';

test('Windows default browser uses the URL protocol association and exact registered executable', async () => {
  const calls=[];
  const execFile=async (file,args,options)=>{calls.push({file,args,options});return {stdout:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n'};};
  const result=await windowsDefaultBrowser('https:',{platform:'win32',execFile});
  assert.equal(result.browser,'chrome');assert.match(result.executablePath,/Google\\Chrome/);
  assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[0].options.timeout,10000);
  const script=Buffer.from(calls[0].args.at(-1),'base64').toString('utf16le');
  assert.match(script,/AssocQueryString/);assert.match(script,/'https'/);assert.doesNotMatch(script,/Set-Item|Start-Process/);
  const edge=await windowsDefaultBrowser('http:',{platform:'win32',execFile:async()=>({stdout:'C:\\Edge\\msedge.exe\n'})});
  assert.equal(edge.browser,'msedge');
});

test('unknown, unavailable and unsupported system browsers never silently fall back to Edge', async () => {
  for(const stdout of ['', 'C:\\Firefox\\firefox.exe', 'cmd.exe /c msedge.exe', 'relative\\chrome.exe']) await assert.rejects(windowsDefaultBrowser('https:',{platform:'win32',execFile:async()=>({stdout})}),/BROWSER_DEFAULT_UNSUPPORTED|BROWSER_DEFAULT_UNAVAILABLE/);
  await assert.rejects(windowsDefaultBrowser('https:',{platform:'linux'}),/BROWSER_DEFAULT_UNSUPPORTED/);
  await assert.rejects(windowsDefaultBrowser('file:',{platform:'win32'}),/BROWSER_URL_INVALID/);
  await assert.rejects(windowsDefaultBrowser('http:',{platform:'win32',execFile:async()=>{throw new Error('sensitive path');}}),error=>error.code==='BROWSER_DEFAULT_UNAVAILABLE'&&!error.message.includes('sensitive path'));
});
