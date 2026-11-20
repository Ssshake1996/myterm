// Viewer hints only: no focus(), scroll(), injected DOM, input values or recording events.
const binding = '__remoteOpsViewFocus';
const validBox = box => box && ['x','y','width','height'].every(key => Number.isFinite(box[key])) && box.width >= 0 && box.height >= 0;

export async function publishBrowserFocus(record, page, kind, rect) {
  const pageId = [...record.pages].find(([,value]) => value === page)?.[0];
  if (!pageId || record.closed || !validBox(rect)) return;
  const revision = record.revision ?? 0, navigation = record.navigationRevision ?? 0;
  const geometry = await page.evaluate(() => ({width:innerWidth,height:innerHeight,scrollX,scrollY})).catch(() => null);
  if (!geometry || ![geometry.width,geometry.height,geometry.scrollX,geometry.scrollY].every(Number.isFinite) ||
      record.pages.get(pageId) !== page || (record.revision ?? 0) !== revision || (record.navigationRevision ?? 0) !== navigation) return;
  const x = Math.max(0,rect.x), y = Math.max(0,rect.y);
  const right = Math.min(geometry.width,rect.x+rect.width), bottom = Math.min(geometry.height,rect.y+rect.height);
  if (right < x || bottom < y || x >= geometry.width || y >= geometry.height) return;
  record.viewFocus = {sequence:(record.focusSequence ?? 0)+1, pageId, revision, navigation, kind,
    ...geometry, at:Date.now(), rect:{x,y,width:right-x,height:bottom-y}};
  record.focusSequence = record.viewFocus.sequence;
  record.view?.focusChanged();
}

export async function focusLocator(record, page, locator, kind) {
  try {
    if (!await locator.count()) return;
    const box = await locator.boundingBox({timeout:150});
    if (box) await publishBrowserFocus(record,page,kind,box);
  } catch { /* A click may remove its target; the captured pointer event is retained. */ }
}

function installObserver(name) {
  if (window.__remoteOpsViewFocusObserver) return;
  window.__remoteOpsViewFocusObserver = true;
  let lastTarget, lastHover = 0, scrollTimer;
  const emit = (kind, target, point) => {
    if (!(target instanceof Element)) return;
    const bounds = target.getBoundingClientRect();
    if (!bounds.width || !bounds.height || bounds.bottom < 0 || bounds.top > innerHeight || bounds.right < 0 || bounds.left > innerWidth) return;
    const rect = point ? {x:point.x,y:point.y,width:0,height:0} : {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
    // Frame-relative coordinates are converted by the owning Playwright Frame below.
    void window[name]({kind,rect,frameWidth:innerWidth,frameHeight:innerHeight}).catch(() => {});
  };
  for (const kind of ['pointerdown','click','mouseover','focusin','input','change']) {
    document.addEventListener(kind,event => {
      if (kind === 'mouseover' && Date.now()-lastHover < 100) return;
      if (kind === 'mouseover') lastHover=Date.now();
      lastTarget=event.target;
      emit(kind,event.target,kind==='pointerdown'||kind==='click'||kind==='mouseover'?{x:event.clientX,y:event.clientY}:null);
    },true);
  }
  document.addEventListener('scroll',() => {
    clearTimeout(scrollTimer);
    scrollTimer=setTimeout(()=>emit('scroll',document.activeElement !== document.body ? document.activeElement : lastTarget),60);
  },true);
}

export async function installBrowserFocus(record) {
  const context = record.context;
  if (!context.exposeBinding || !context.addInitScript) return;
  await context.exposeBinding(binding,async (source,payload) => {
    if (record.context !== context || record.closed || !validBox(payload?.rect) ||
        !['pointerdown','click','mouseover','focusin','input','change','scroll'].includes(payload.kind)) return;
    let rect = payload.rect;
    try {
      if (source.frame !== source.page.mainFrame()) {
        const element = await source.frame.frameElement();
        try {
          const box = await element.boundingBox();
          const border = await element.evaluate(node => ({left:node.clientLeft,top:node.clientTop,width:node.offsetWidth,height:node.offsetHeight}));
          if (!box || !payload.frameWidth || !payload.frameHeight || !border.width || !border.height) return;
          const sx=box.width/border.width,sy=box.height/border.height;
          rect={x:box.x+(rect.x+border.left)*sx,y:box.y+(rect.y+border.top)*sy,width:rect.width*sx,height:rect.height*sy};
        } finally { await element.dispose(); }
      }
      await publishBrowserFocus(record,source.page,payload.kind,rect);
    } catch { /* Frame navigation and closure can race a display hint. */ }
  });
  await context.addInitScript(installObserver,binding);
  await Promise.all(context.pages().flatMap(page => page.frames().map(frame => frame.evaluate(installObserver,binding).catch(() => {}))));
}
