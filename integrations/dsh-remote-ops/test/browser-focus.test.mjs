import test from 'node:test';
import assert from 'node:assert/strict';
import {publishBrowserFocus} from '../lib/browser-focus.js';
import {BrowserView} from '../lib/browser-view.js';

test('focus is bounded in CSS pixels, page scoped, and never changes the page', async () => {
  const page = {evaluate:async()=>({width:1280,height:768,scrollX:0,scrollY:400})};
  const record = {pages:new Map([['p',page]]),activePageId:'p',revision:4,navigationRevision:3};
  await publishBrowserFocus(record,page,'click',{x:1200,y:640,width:90,height:30});
  assert.equal(record.viewFocus.pageId,'p'); assert.equal(record.viewFocus.rect.width,80);
  assert.equal(record.viewFocus.scrollY,400); assert.equal(record.viewFocus.revision,4);
  assert.ok(!JSON.stringify(record.viewFocus).includes('text'));
  const previous = record.viewFocus;
  await publishBrowserFocus(record,{},'click',{x:1,y:1,width:10,height:10});
  assert.equal(record.viewFocus,previous);
  await publishBrowserFocus(record,page,'click',{x:NaN,y:1,width:1,height:1});
  assert.equal(record.viewFocus,previous);
});

test('a focus-only update wakes the viewer, but a different scroll or page cannot reuse it', async () => {
  const record = {activePageId:'p',revision:1,navigationRevision:2};
  const view = new BrowserView(record); record.view = view;
  view.latest={sequence:1,pageId:'p',revision:1,navigation:2,width:1280,height:768,scrollX:0,scrollY:0,data:'image'};
  view.sequence=1;
  record.viewFocus={sequence:1,pageId:'p',revision:1,navigation:2,width:1280,height:768,scrollX:0,scrollY:0,at:Date.now(),rect:{x:1200,y:100,width:30,height:30}};
  let woke=false; view.waiters.add(()=>{woke=true;}); view.focusChanged();
  assert.ok(woke); assert.equal(view.latest.sequence,2);
  assert.equal(view.present().focus.sequence,1);
  record.viewFocus.scrollY=100; assert.equal(view.present().focus,null);
  record.viewFocus.scrollY=0; record.viewFocus.pageId='other'; assert.equal(view.present().focus,null);
});
