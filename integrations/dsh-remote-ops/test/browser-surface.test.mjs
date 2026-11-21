import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
const start=source.indexOf('    const browserSurfaceGeometry =');
const context={};
assert.ok(start>=0,'surface geometry helper exists');
vm.runInNewContext(source.slice(start,source.indexOf('    function BrowserLiveView',start))+'\nglobalThis.geometry=browserSurfaceGeometry;globalThis.wheel=browserWheelInput;globalThis.reveal=browserRevealFocus;',context);
test('fit contains the entire CSS viewport with letterboxing and reversible coordinates',()=>{
  for(const [width,height] of [[1027,768],[390,640],[1440,400]]){
    const box=context.geometry({width:1280,height:768},width,height,true);
    assert.ok(box.width<=width+.001&&box.height<=height+.001);
    assert.ok(Math.abs(box.width/box.height-1280/768)<.00001);
    for(const [x,y] of [[0,0],[1250,740],[640,384]]){
      assert.ok(Math.abs(((box.left+x*box.scale)-box.left)/box.scale-x)<.001);
      assert.ok(Math.abs(((box.top+y*box.scale)-box.top)/box.scale-y)<.001);
    }
  }
});
test('original size preserves native CSS coordinates and scroll extent',()=>{
  const box=context.geometry({width:1920,height:1080},1027,768,false);
  assert.equal(box.width,1920);assert.equal(box.height,1080);assert.equal(box.scale,1);
});

test('two-axis outer panning consumes wheel movement before scrolling the page under the pointer',()=>{
  const surface={clientWidth:600,clientHeight:400,scrollWidth:1024,scrollHeight:768,scrollLeft:0,scrollTop:0};
  const image={getBoundingClientRect:()=>({left:20-surface.scrollLeft,top:50-surface.scrollTop,width:1024,height:768})};
  const frame={width:1024,height:768},event={deltaX:200,deltaY:200,clientX:320,clientY:250,deltaMode:0};
  assert.equal(context.wheel(surface,image,frame,event,false),null);
  assert.equal(surface.scrollLeft,200);assert.equal(surface.scrollTop,200);
  const input=context.wheel(surface,image,frame,{...event,deltaX:300,deltaY:300},false);
  assert.equal(surface.scrollLeft,424);assert.equal(surface.scrollTop,368);
  assert.equal(input.x,76);assert.equal(input.y,132);assert.equal(input.position.x,724);assert.equal(input.position.y,568);
});
test('fit wheel maps the cursor to CSS pixels without scrolling the outer surface',()=>{
  const node={clientWidth:512,clientHeight:384,scrollWidth:512,scrollHeight:384,scrollLeft:0,scrollTop:0};
  const image={getBoundingClientRect:()=>({left:10,top:20,width:512,height:384})};
  const input=context.wheel(node,image,{width:1024,height:768},{deltaX:0,deltaY:3,deltaMode:1,clientX:310,clientY:220},true);
  assert.equal(input.y,48);assert.equal(input.position.x,600);assert.equal(input.position.y,400);
  assert.equal(node.scrollTop,0);
});
test('focus follow reveals the whole target and clamps to the original-size frame',()=>{
  const node={clientWidth:626,clientHeight:466,scrollWidth:1280,scrollHeight:1600,scrollLeft:0,scrollTop:0},rect={x:904,y:1340,width:100,height:40};
  context.reveal(node,rect);
  assert.ok(rect.x>=node.scrollLeft&&rect.x+rect.width<=node.scrollLeft+node.clientWidth);
  assert.ok(rect.y>=node.scrollTop&&rect.y+rect.height<=node.scrollTop+node.clientHeight);
  context.reveal(node,{x:0,y:0,width:20,height:20});assert.equal(node.scrollLeft,0);assert.equal(node.scrollTop,0);
});
