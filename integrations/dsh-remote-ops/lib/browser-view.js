import {browserError} from './browser-steps.js';

// One latest frame, shared by this browser's viewers. Disconnecting a viewer
// never owns the browser/job lifecycle. Raw user frames never enter tool output.
export class BrowserView {
  constructor(record) { this.record=record; this.sequence=0; this.waiters=new Set(); this.acks=new Set(); }
  async start() {
    const r=this.record;
    if(r.closed||r.switching) throw browserError('BROWSER_CLOSED','The browser is closed or changing display');
    if(this.cdp&&this.pageId===r.activePageId&&this.startedRevision===(r.revision??0)) return;
    if(this.starting) {await this.starting;return this.start();}
    this.starting=(async()=>{
      await this.stop();
      const page=r.pages.get(r.activePageId);
      if(!page)throw browserError('BROWSER_CLOSED','No page is open');
      const cdp=await r.context.newCDPSession(page);this.cdp=cdp;this.pageId=r.activePageId;this.startedRevision=r.revision??0;
      cdp.on('Page.screencastFrame',event=>{
        if(this.cdp!==cdp)return;
        const timer=setTimeout(()=>{this.acks.delete(timer);void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});},100);
        timer.unref?.();this.acks.add(timer);
        if(event.metadata.timestamp&&event.metadata.timestamp*1000<(r.navigatedAt??0))return;
        this.latest={sequence:++this.sequence,pageId:this.pageId,revision:r.revision??0,width:event.metadata.deviceWidth,height:event.metadata.deviceHeight,at:new Date().toISOString(),data:event.data};
        for(const wake of this.waiters)wake();
      });
      await cdp.send('Page.startScreencast',{format:'jpeg',quality:75,maxWidth:1600,maxHeight:1200,everyNthFrame:1});
    })();
    try{await this.starting;}catch(error){await this.stop();throw error;}finally{this.starting=null;}
  }
  async frame({after=0,signal}={}) {
    if(signal?.aborted)throw signal.reason??new Error('aborted');
    await this.start();clearTimeout(this.expiry);
    this.expiry=setTimeout(()=>void this.stop(),20000);this.expiry.unref?.();
    const valid=()=>this.latest?.pageId===this.record.activePageId&&this.latest.revision===(this.record.revision??0);
    if(valid()&&this.latest.sequence>Number(after))return this.latest;
    await new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);this.waiters.delete(wake);signal?.removeEventListener('abort',abort);};
      const wake=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(signal.reason??new Error('aborted'));};
      this.waiters.add(wake);signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(wake,8000);timer.unref?.();
      if(signal?.aborted)abort();else if(valid()&&this.latest.sequence>Number(after))wake();
    });
    if(!valid())throw browserError('BROWSER_FRAME_PENDING','Waiting for a new page frame');
    return this.latest;
  }
  async stop() {
    const cdp=this.cdp;this.cdp=null;this.latest=null;clearTimeout(this.expiry);
    for(const timer of this.acks)clearTimeout(timer);this.acks.clear();
    for(const wake of [...this.waiters])wake();
    if(cdp){await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{});}
  }
  invalidate(){this.latest=null;for(const wake of [...this.waiters])wake();}
}

export async function browserInput(workspace,record,input) {
  if(record.closed||record.switching)throw browserError('BROWSER_CLOSED','The browser is closed or changing display');
  if(input.pageId!==record.activePageId||input.revision!==(record.revision??0))throw browserError('BROWSER_FRAME_STALE','The page changed. Wait for a fresh frame before interacting');
  const page=record.pages.get(record.activePageId),finite=value=>Number.isFinite(value);
  if(input.kind==='click') {
    const f=record.view?.latest;
    if(!f||!finite(input.x)||!finite(input.y)||input.x<0||input.y<0||input.x>=f.width||input.y>=f.height||!['left','middle','right'].includes(input.button??'left')||![1,2].includes(input.count??1))throw browserError('BROWSER_INPUT_INVALID','Invalid pointer coordinates');
    await page.mouse.click(input.x,input.y,{button:input.button??'left',clickCount:input.count??1});
  }else if(input.kind==='wheel') {
    if(!finite(input.x)||!finite(input.y)||Math.abs(input.x)>3000||Math.abs(input.y)>3000)throw browserError('BROWSER_INPUT_INVALID','Invalid scroll distance');
    await page.mouse.wheel(input.x,input.y);
  }else if(input.kind==='text') {
    if(typeof input.text!=='string'||input.text.length>16000)throw browserError('BROWSER_INPUT_INVALID','Text is too long');
    await page.keyboard.insertText(input.text);
  }else if(input.kind==='key') {
    if(typeof input.key!=='string'||input.key.length>100||!/^(?:(?:Control|Meta|Alt|Shift)\+)*(?:Enter|Tab|Backspace|Delete|Escape|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|[a-zA-Z0-9])$/.test(input.key))throw browserError('BROWSER_INPUT_INVALID','Unsupported key');
    await page.keyboard.press(input.key);
  }else throw browserError('BROWSER_INPUT_INVALID','Unsupported input');
  return {accepted:true,pageId:record.activePageId};
}
