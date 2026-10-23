import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source=await readFile(new URL("../lib/client.js",import.meta.url),"utf8");
const tick=()=>new Promise(setImmediate);

function fixture(storage=new Map()) {
  let plugin,active;
  let catalog={groups:[],environments:[],sessions:[],quickCommands:[],quickGroups:[],events:[],agent:{bound:true},pluginVersion:"0.4.0"};
  const doc={activeElement:null,hidden:false,getElementById:()=>({textContent:""}),addEventListener(){},removeEventListener(){}};
  const hook=()=>active.hooks[active.index++]??= {};
  const React={
    Fragment:"fragment",createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),
    useState(initial){const h=hook();if(!("value" in h))h.value=typeof initial==="function"?initial():initial;return[h.value,value=>{h.value=typeof value==="function"?value(h.value):value;}];},
    useRef(initial){const h=hook();return h.value??={current:initial};},
    useEffect(effect,deps){const h=hook();if(!h.deps||!deps||deps.some((v,i)=>v!==h.deps[i])){h.deps=deps;active.effects.push(()=>{h.cleanup?.();h.cleanup=effect();});}},
    useMemo(fn,deps){const h=hook();if(!h.deps||deps.some((v,i)=>v!==h.deps[i])){h.value=fn();h.deps=deps;}return h.value;},
    useCallback(fn,deps){return React.useMemo(()=>fn,deps);},
    useSyncExternalStore(_subscribe,snapshot){return snapshot();},
  };
  const store={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const window={__ModuleLoader__:{load:def=>{plugin=def.factory(name=>name==="react"?React:{});}},addEventListener(){},removeEventListener(){},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn()};
  vm.runInNewContext(source.replace("return { inject, apply };","return { inject, apply, RemoteOpsPanel, ModalDialog: typeof ModalDialog === 'undefined' ? null : ModalDialog };"),{
    window,document:doc,localStorage:store,sessionStorage:store,URLSearchParams,AbortController,
    setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=>"id"},
    fetch:async (url,init)=>({ok:true,text:async()=>JSON.stringify(url.includes("/update")?{currentVersion:"0.4.0"}:init?.body&&JSON.parse(init.body).action==="enter"?{sessionId:"ssh-test"}:catalog)}),
  });
  const nodes=tree=>{const all=[];const visit=node=>{if(node&&typeof node==="object"){all.push(node);node.children?.forEach(visit);}};visit(tree);return all;};
  function mount(name,props,flush=true){
    const view={hooks:[],effects:[],index:0};
    view.flush=()=>view.effects.splice(0).forEach(effect=>effect());
    view.render=(runEffects=true)=>{view.index=0;active=view;view.tree=plugin[name](props);active=null;if(runEffects)view.flush();return view;};
    view.find=fn=>nodes(view.tree).find(fn);view.all=fn=>nodes(view.tree).filter(fn);
    view.unmount=()=>view.hooks.forEach(h=>h.cleanup?.());
    return view.render(flush);
  }
  return {plugin,doc,storage,mount,catalog:value=>{catalog={...catalog,...value};}};
}

test("workspace tabs retain the chosen module across remounts and refresh without leaking into another conversation",async()=>{
  const storage=new Map(),f=fixture(storage),view=f.mount("RemoteOpsPanel",{sessionId:"a"});await tick();view.render();
  assert.ok(view.find(n=>n.props.role==="tablist"&&n.props["aria-label"]==="Remote Ops 工作区"));
  assert.deepEqual(view.all(n=>n.props.role==="tab").map(n=>n.props["aria-label"]),["终端","网页","文件","API"]);
  view.find(n=>n.props.role==="tab"&&n.props["aria-label"]==="网页").props.onClick();view.render();view.unmount();
  const reopened=f.mount("RemoteOpsPanel",{sessionId:"a"});
  assert.equal(reopened.find(n=>n.props["data-module"]).props["data-module"],"browser");reopened.unmount();
  const refreshed=fixture(storage);
  assert.equal(refreshed.mount("RemoteOpsPanel",{sessionId:"a"}).find(n=>n.props["data-module"]).props["data-module"],"browser");
  assert.equal(refreshed.mount("RemoteOpsPanel",{sessionId:"b"}).find(n=>n.props["data-module"]).props["data-module"],"terminal");
  assert.ok([...storage.values()].every(v=>!v.includes("password")&&!v.includes("stdout")));
});

test("workspace tabs use roving focus and arrows activate the destination without toggling back to terminal",async()=>{
  const f=fixture(),view=f.mount("RemoteOpsPanel",{sessionId:"a"});await tick();view.render();
  let prevented=false,focused=false;
  const first=view.find(n=>n.props.role==="tab");assert.ok(first,"workspace navigation must expose tabs");
  first.props.onKeyDown({key:"ArrowRight",preventDefault:()=>{prevented=true;},currentTarget:{parentElement:{children:[{}, {focus:()=>{focused=true;}}]}}});view.render();
  assert.equal(prevented,true);assert.equal(focused,true);
  let selected=view.find(n=>n.props.role==="tab"&&n.props["aria-selected"]);
  assert.equal(selected.props["aria-label"],"网页");assert.equal(selected.props.tabIndex,0);
  selected.props.onClick();view.render();
  assert.equal(view.find(n=>n.props["data-module"]).props["data-module"],"browser");
});

test("entering an environment from Web returns to its terminal workspace",async()=>{
  const f=fixture();f.catalog({groups:["dev"],environments:[{id:"ssh-test",name:"Test",host:"fixture",username:"tester",group:"dev",connectionCount:0}]});
  const view=f.mount("RemoteOpsPanel",{sessionId:"a"});await tick();view.render();
  view.find(n=>n.props.role==="tab"&&n.props["aria-label"]==="网页").props.onClick();view.render();
  view.find(n=>n.props["aria-label"]==="环境管理").props.onClick();view.render();
  view.find(n=>n.type==="button"&&n.children.includes("进入")).props.onClick();await tick();view.render();
  assert.equal(view.find(n=>n.props["data-module"]).props["data-module"],"terminal");
});

test("panel dialogs contain Tab, close on Escape and return focus to the invoking control",()=>{
  const f=fixture();assert.equal(typeof f.plugin.ModalDialog,"function","all panel dialogs need one focus lifecycle");
  let closed=0,returned=0;
  const previous={isConnected:true,focus:()=>{returned++;f.doc.activeElement=previous;}};f.doc.activeElement=previous;
  const first={focus:()=>{f.doc.activeElement=first;}},last={focus:()=>{f.doc.activeElement=last;}};
  const view=f.mount("ModalDialog",{title:"Example",onClose:()=>closed++,children:"content"},false);
  const dialog=view.find(n=>n.props.role==="dialog");
  dialog.props.ref.current={querySelector:()=>first,querySelectorAll:()=>[first,last],contains:node=>[first,last].includes(node)};view.flush();
  assert.equal(f.doc.activeElement,first);
  let prevented=0;
  dialog.props.onKeyDown({key:"Tab",shiftKey:true,preventDefault:()=>prevented++,stopPropagation(){}});
  assert.equal(f.doc.activeElement,last);
  dialog.props.onKeyDown({key:"Tab",shiftKey:false,preventDefault:()=>prevented++,stopPropagation(){}});
  assert.equal(f.doc.activeElement,first);assert.equal(prevented,2);
  dialog.props.onKeyDown({key:"Escape",preventDefault(){},stopPropagation(){}});assert.equal(closed,1);
  view.unmount();assert.equal(returned,1);
});
