import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCursor,standardCursor} from '../lib/browser-cursor.js';

test('cursor responses contain standard keywords rather than website image URLs',()=>{
  assert.equal(standardCursor('text'),'text');
  assert.equal(standardCursor('url("https://cursor.test/private.png"), pointer'),'pointer');
  assert.equal(standardCursor('auto'),'default');
  assert.equal(standardCursor('unexpected-value'),'default');
});

test('cursor queries reject invalid coordinates and stale or modal pages without reading them',async()=>{
  let reads=0;
  const record={display:'embedded',activePageId:'one',revision:2,viewport:{width:800,height:600},pages:new Map([['one',{mainFrame:()=>{reads++;}}]])};
  const input={pageId:'one',revision:2,x:20,y:20};
  assert.equal((await browserCursor(record,{...input,revision:1})).accepted,false);
  for(const point of [{x:-1,y:0},{x:800,y:0},{x:0,y:600},{x:NaN,y:0}])
    await assert.rejects(browserCursor(record,{...input,...point}),/BROWSER_CURSOR_INVALID/);
  record.dialog={};assert.equal((await browserCursor(record,input)).accepted,false);
  assert.equal(reads,0);
});

test('a cursor read finishing after navigation is discarded and releases its remote handle',async()=>{
  let finish,disposed=0;
  const handle={evaluate:()=>new Promise(r=>{finish=r;}),dispose:async()=>{disposed++;}};
  const frame={evaluateHandle:async()=>handle};
  const record={display:'embedded',activePageId:'one',revision:2,viewport:{width:800,height:600},pages:new Map([['one',{mainFrame:()=>frame}]])};
  const pending=browserCursor(record,{pageId:'one',revision:2,x:20,y:20});
  await Promise.resolve();record.revision++;
  finish({cursor:'text'});
  assert.deepEqual(await pending,{cursor:'default',accepted:false});assert.equal(disposed,1);
});
