import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
const start=source.indexOf('    const browserWheelInput ='),context={};
assert.ok(start>=0);
vm.runInNewContext(source.slice(start,source.indexOf('    function BrowserLiveView',start))+'\nglobalThis.wheel=browserWheelInput;',context);

test('wheel goes to the page at the CSS pixel under the pointer without outer panning',()=>{
  const node={clientWidth:1027,clientHeight:768,scrollLeft:0,scrollTop:0};
  const image={getBoundingClientRect:()=>({left:10,top:20,width:1027,height:768})};
  const input=context.wheel(node,image,{width:1027,height:768},{deltaX:240,deltaY:360,deltaMode:0,clientX:710,clientY:420});
  assert.equal(input.x,240);assert.equal(input.y,360);
  assert.equal(input.position.x,700);assert.equal(input.position.y,400);
  assert.equal(node.scrollLeft,0);assert.equal(node.scrollTop,0);
});
test('shift wheel scrolls horizontally and page deltas use the actual panel',()=>{
  const node={clientWidth:600,clientHeight:400},image={getBoundingClientRect:()=>({left:0,top:0,width:600,height:400})},frame={width:600,height:400};
  const input=context.wheel(node,image,frame,{deltaX:0,deltaY:3,deltaMode:1,shiftKey:true,clientX:300,clientY:200});
  assert.equal(input.x,48);assert.equal(input.y,0);
  assert.equal(context.wheel(node,image,frame,{deltaX:0,deltaY:1,deltaMode:2,clientX:300,clientY:200}).y,400);
  assert.equal(context.wheel(node,null,frame,{}),null);
});
