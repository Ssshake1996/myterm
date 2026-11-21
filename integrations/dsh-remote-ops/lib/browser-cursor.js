import {browserError} from './browser-steps.js';

const cursors = new Set('default none context-menu help pointer progress wait cell crosshair text vertical-text alias copy move no-drop not-allowed grab grabbing all-scroll col-resize row-resize n-resize e-resize s-resize w-resize ne-resize nw-resize se-resize sw-resize ew-resize ns-resize nesw-resize nwse-resize zoom-in zoom-out'.split(' '));
export const standardCursor = value => {
  const keyword = String(value ?? '').trim().match(/([a-z-]+)$/)?.[1];
  return cursors.has(keyword) ? keyword : 'default';
};

// Read-only hit testing: moving the local mouse must not click, focus, scroll,
// move the remote pointer or add an automation/recording event.
function hitCursor({x,y}) {
  let node = document.elementFromPoint(x,y);
  while (node?.shadowRoot) {
    const inner = node.shadowRoot.elementFromPoint(x,y);
    if (!inner || inner === node) break;
    node = inner;
  }
  if (!node) return {cursor:'default'};
  let cursor = getComputedStyle(node).cursor;
  if (cursor === 'auto' && node.isContentEditable) cursor = 'text';
  if (node instanceof HTMLIFrameElement || node instanceof HTMLFrameElement) {
    const box=node.getBoundingClientRect(),sx=box.width/node.offsetWidth,sy=box.height/node.offsetHeight;
    const point={x:(x-box.left)/sx-node.clientLeft,y:(y-box.top)/sy-node.clientTop};
    if (sx && sy && point.x>=0 && point.y>=0 && point.x<node.clientWidth && point.y<node.clientHeight)
      return {cursor,element:node,point};
  }
  return {cursor};
}

export async function browserCursor(record,input) {
  const current=()=>!record.closed&&!record.switching&&record.display==='embedded'&&
    input?.pageId===record.activePageId&&input?.revision===(record.revision??0);
  const fallback={cursor:'default',accepted:false};
  if (!current() || record.dialog) return fallback;
  if (![input.x,input.y].every(Number.isFinite) || input.x<0 || input.y<0 ||
      input.x>=record.viewport.width || input.y>=record.viewport.height)
    throw browserError('BROWSER_CURSOR_INVALID','Cursor coordinates must be inside the current viewport');
  let frame=record.pages.get(input.pageId)?.mainFrame(),point={x:input.x,y:input.y},cursor='default';
  try {
    for(let depth=0;frame&&depth<12;depth++) {
      const hit=await frame.evaluateHandle(hitCursor,point);
      let element;
      try {
        const value=await hit.evaluate(({cursor,point})=>({cursor,point}));
        cursor=standardCursor(value.cursor);
        if(!value.point)break;
        element=await hit.getProperty('element');
        frame=await element.asElement()?.contentFrame();point=value.point;
      } finally {await element?.dispose();await hit.dispose();}
    }
    return current()?{cursor,accepted:true,pageId:input.pageId,revision:input.revision}:fallback;
  } catch {return fallback;} // Navigation, detached frames and modal dialogs can race a display hint.
}
