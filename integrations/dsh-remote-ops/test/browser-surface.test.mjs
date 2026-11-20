import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
const start=source.indexOf('    const browserSurfaceGeometry =');
const context={};
assert.ok(start>=0,'surface geometry helper exists');
vm.runInNewContext(source.slice(start,source.indexOf('    function BrowserLiveView',start))+'\nglobalThis.geometry=browserSurfaceGeometry;',context);
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
