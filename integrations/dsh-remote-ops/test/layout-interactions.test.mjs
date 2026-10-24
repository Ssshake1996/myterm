import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {jsonPointerChild,jsonTreeRows} from '../lib/api-client.js';
import {withSnapshots} from '../lib/state/snapshots.js';

const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
const start=source.indexOf('    const terminalUnreadState ='),end=source.indexOf('    function RemoteOpsPanel(',start);
const context={};vm.runInNewContext(source.slice(start,end)+'\nglobalThis.helpers={terminalUnreadState,workspaceBadges};',context);
const {terminalUnreadState,workspaceBadges}=context.helpers;

test('JSON Pointer represents slash, tilde, empty keys and array indices without copying values',()=>{
  assert.equal(jsonPointerChild('/data','a~/b'),'/data/a~0~1b');
  const value={'':{'~/':[null,false,0,'secret-value']}};
  const tree=jsonTreeRows(value,new Set(['','/','//~0~1']));
  assert.deepEqual(tree.rows.map(row=>row.pointer),['','/','//~0~1','//~0~1/0','//~0~1/1','//~0~1/2','//~0~1/3']);
  assert.ok(tree.rows.every(row=>!row.pointer.includes('secret-value')));
  assert.equal(tree.rows[3].value,null);assert.equal(tree.rows[4].value,false);
  assert.equal(jsonTreeRows(null,new Set([''])).rows[0].container,false);
});

test('JSON collapse, wide arrays and deep responses bound rendering without losing raw data',()=>{
  const large=Array.from({length:10000},(_,i)=>i);
  const collapsed=jsonTreeRows(large,new Set());assert.equal(collapsed.rows.length,1);assert.equal(collapsed.more,false);
  const first=jsonTreeRows(large,new Set(['']),500);assert.equal(first.rows.length,500);assert.equal(first.more,true);
  assert.equal(jsonTreeRows(large,new Set(['']),1000).rows[999].value,998);
  let deep=1;for(let i=0;i<1000;i++)deep={a:deep};
  const expanded=new Set(Array.from({length:1000},(_,i)=>'/a'.repeat(i)));
  const nested=jsonTreeRows(deep,expanded);assert.equal(nested.rows.length,33);assert.equal(nested.rows.at(-1).depthLimited,true);
  assert.equal(large.length,10000);
});

test('terminal unread tracks output cursors per session and clears only after that output is displayed',()=>{
  const sessions=[{sessionId:'a',outputCursor:{streamId:'s1',offset:20}},{sessionId:'b',outputCursor:{streamId:'s2',offset:30}}];
  let next=terminalUnreadState({}, {},sessions,'',{},'owner');assert.equal(Object.keys(next.unread).length,0);
  sessions[0].outputCursor={streamId:'s1',offset:25};sessions[1].outputCursor={streamId:'s2',offset:35};
  next=terminalUnreadState(next.seen,next.unread,sessions,'a',{'owner:a':{streamId:'s1',nextOffset:20}},'owner');
  assert.deepEqual(Object.keys(next.unread),['a','b']);
  next=terminalUnreadState(next.seen,next.unread,sessions,'a',{'owner:a':{streamId:'s1',nextOffset:25}},'owner');
  assert.deepEqual(Object.keys(next.unread),['b']);
  next=terminalUnreadState(next.seen,next.unread,sessions,'b',{'owner:b':{streamId:'old-stream',nextOffset:99}},'owner');
  assert.deepEqual(Object.keys(next.unread),['b']);
  next=terminalUnreadState(next.seen,next.unread,[sessions[0]],'',{},'owner');assert.equal(Object.keys(next.unread).length,0);
});

test('badges aggregate real jobs, avoid fake percentages and retain unseen failures',()=>{
  const seen={sftp:[],browser:[]},activity={transfers:[{id:'t',status:'running',source:'ssh'}],activeBrowserId:null,browsers:[{id:'b',status:'running',index:1,count:3}]};
  let badges=workspaceBadges(activity,null,{a:true,b:true},seen);
  assert.equal(badges.sftp.label,'传输中');assert.equal(badges.browser.description,'1/3 步');assert.equal(badges.terminal.label,'2');
  activity.transfers=[{id:'upload',status:'running',source:'browser'}];
  badges=workspaceBadges(activity,{status:'uploading',bytes:50,total:100},{},seen);assert.equal(badges.sftp.label,'50%');
  activity.transfers.push({id:'other',status:'running',source:'ssh'});
  assert.equal(workspaceBadges(activity,{status:'uploading',bytes:50,total:100},{},seen).sftp.label,'2 传输');
  activity.transfers=[{id:'failed',status:'failed',source:'ssh'}];activity.browsers=[{id:'unknown',status:'unknown'}];
  assert.equal(workspaceBadges(activity,null,{},seen).sftp.tone,'error');
  assert.equal(workspaceBadges(activity,null,{},seen).browser.label,'待检查');
  assert.equal(Object.keys(workspaceBadges(activity,null,{}, {sftp:['failed'],browser:['unknown']})).length,0);
});

test('background snapshot is owner scoped and includes no browser targets, credentials or terminal content',()=>{
  const State=withSnapshots(class {}),state=new State();
  state.transfers={list:owner=>owner==='a'?[{id:'t',status:'running',source:{kind:'ssh',password:'secret'}}]:[]};
  state.browser={sessions:new Map([['a',{id:'a',owner:'a',job:{id:'a-job',steps:[{password:'secret'}],status:'running',index:0},secret:'secret'}],['b',{id:'b',owner:'b',job:{id:'private-job',steps:[],status:'failed'}}]])};
  assert.deepEqual(state.workspaceActivity('a'),{transfers:[{id:'t',status:'running',source:'ssh'}],activeBrowserId:null,browsers:[{browserId:'a',id:'a-job',status:'running',index:0,count:1}]});
  assert.equal(JSON.stringify(state.workspaceActivity('a')).includes('secret'),false);
  assert.deepEqual(state.outputCursor({outputBuffer:{streamId:'x',endOffset:12,value:'sensitive-output'}}),{streamId:'x',offset:12});
});
