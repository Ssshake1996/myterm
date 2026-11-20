import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
const start=source.indexOf('    const terminalReadableStyle =');
assert.ok(start>=0,'terminal contrast protection must exist');
const context={};
vm.runInNewContext(source.slice(start,source.indexOf('    const parseSshCommand =',start))+'\nglobalThis.readable=terminalReadableStyle;',context);
const readable=context.readable;
const rgb=value=>value.startsWith('#')?value.slice(1).match(/../g).map(v=>parseInt(v,16)):value.match(/[\d.]+/g).map(Number);
const luminance=value=>rgb(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const themes=value=>value.startsWith('light-dark(')?value.slice(11,-1).match(/#[\da-f]{6}|rgb\([^)]+\)/gi):[value,value];

test('low contrast ANSI, indexed and truecolor pairs are readable in both themes without changing backgrounds',()=>{
  for(const [color,backgroundColor] of [
    ['var(--ro-ansi-4,#3779c5)','var(--ro-ansi-2,#27845a)'],
    ['#1e66f5','#40a02b'],['rgb(0,0,255)','rgb(0,135,0)'],
    ['rgb(120,121,122)','rgb(121,122,123)'],['#ffffff','#ffffff'],['#000000','#000000']
  ]){
    const original={color,backgroundColor,fontWeight:700};
    const result=readable(original);
    const bg=backgroundColor.match(/#[\da-f]{6}/i)?.[0]??backgroundColor;
    for(const fg of themes(result.color))assert.ok(ratio(fg,bg)>=4.5,`${fg} on ${bg}`);
    assert.equal(result.backgroundColor,backgroundColor);
    assert.equal(result.fontWeight,700);
    assert.equal(original.color,color,'do not mutate VT rendition or raw/log data');
  }
});

test('default foreground/background, semantic commands and status tones also get protection',()=>{
  for(const role of [undefined,'command','agent-command','directory','file']){
    const result=readable({backgroundColor:'#40a02b'},role);
    for(const fg of themes(result.color))assert.ok(ratio(fg,'#40a02b')>=4.5);
  }
  const result=readable({color:'#777777'});
  const colors=themes(result.color);
  assert.ok(ratio(colors[0],'#f5f7fb')>=4.5);
  assert.ok(ratio(colors[1],'#19222f')>=4.5);
  for(const tone of ['error','warning','success']){
    const styled=readable({backgroundColor:'#40a02b'},undefined,true,tone);
    for(const fg of themes(styled.color))assert.ok(ratio(fg,'#40a02b')>=4.5);
  }
});

test('readable colors and the opt-out preserve original styles',()=>{
  const original={color:'#ffffff',backgroundColor:'#003300',textDecoration:'underline'};
  assert.equal(readable(original),original);
  const poor={color:'#1e66f5',backgroundColor:'#40a02b'};
  assert.equal(readable(poor,undefined,false),poor);
  assert.equal(readable(undefined),undefined);
  assert.equal(readable({fontStyle:'italic'}).fontStyle,'italic');
});
