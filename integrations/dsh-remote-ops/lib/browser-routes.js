import { ownerId } from "./common.js";
import { browserError, browserRunSource, browserTarget } from "./browser-steps.js";

const headers = { "Cache-Control": "no-store" };
const configuration = new Set(["site.save", "site.delete", "flow.save", "flow.delete", "runtime.install", "preferences.save"]);
export function registerBrowserRoutes(ctx, state) {
  const workspace = state.browser;
  const register = definition => ctx.effect(() => ctx.connection.fetch.register({ requestBody: "buffered", ...definition }), "dsh-remote-ops browser route");
  register({ path: "/api/dsh-remote-ops/browser", methods: ["GET", "POST"], fetch: async request => {
    try {
      await workspace.ready;
      if (request.method === "GET") {
        const agent = ctx.agents.get(new URL(request.url).searchParams.get("sessionId"));
        return Response.json({ ...workspace.snapshot(agent ? ownerId(agent) : undefined), bound: !!agent, runtime: await workspace.runtime() }, { headers });
      }
      const body = await request.json();
      let owner;
      if (!configuration.has(body.action)) owner = ownerId(await state.resolveOwner(body.sessionId));
      let result;
      switch (body.action) {
        case 'preferences.save': result=await workspace.savePreferences(body.preferences);break;
        case 'open-url': result=await workspace.openUrl(owner,body.url,{display:body.display,browser:body.browser});break;
        case 'navigate': result=await workspace.navigate(owner,body.browserId,body.navigation??'goto',body.url);break;
        case 'input': result=await workspace.input(owner,body.browserId,body.input);break;
        case 'viewport': result=await workspace.resizeViewport(owner,body.browserId,body.viewport);break;
        case 'display': result=await workspace.changeDisplay(owner,body.browserId,body.display);break;
        case 'select-browser': {const record=workspace.session(owner,body.browserId);workspace.active.set(owner,record.id);result=workspace.publicSession(record);break;}
        case "site.save": result = await workspace.saveSite(body.site, body.password); break;
        case "site.delete": result = await workspace.deleteSite(body.siteId); break;
        case "flow.save": result = await workspace.saveFlow(body.flow); break;
        case "flow.delete": result = await workspace.deleteFlow(body.flowId); break;
        case "runtime.install": result = await workspace.install(); break;
        case "open": result = await workspace.open(owner, body.siteId,{display:body.display??workspace.preferences.display}); break;
        case "run": result = workspace.publicJob(workspace.session(owner, body.browserId), await workspace.run(owner, body.browserId, browserRunSource(body), { requestId: body.requestId, mode: body.mode, variables: body.variables, pageId: body.pageId })); break;
        case "login": {
          const job = await workspace.login(owner, body.browserId, { requestId: body.requestId });
          result = job.authenticated ? job : workspace.publicJob(workspace.session(owner, body.browserId), job); break;
        }
        case "control": result = await workspace.control(owner, body.browserId, body.control, body.value); break;
        case "observe": result = await workspace.observe(owner, body.browserId); break;
        case "target.test": result = await workspace.testTarget(owner, body.browserId, browserTarget(body.target)); break;
        case "capture": { const shot = await workspace.capture(workspace.session(owner, body.browserId)); result = { at: shot.at, pageId: shot.pageId }; break; }
        default: throw browserError("BROWSER_ACTION_INVALID", "Unknown browser action");
      }
      return Response.json({ ok: true, result }, { headers });
    } catch (error) { return Response.json({ error: error.message, code: error.code ?? "BROWSER_OPERATION_FAILED" }, { status: 400, headers }); }
  } });
  register({path:'/api/dsh-remote-ops/browser/frame',methods:['GET'],fetch:async request=>{
    try {
      const url=new URL(request.url),agent=ctx.agents.get(url.searchParams.get('sessionId'));
      if(!agent)throw browserError('BROWSER_OWNER_REQUIRED','Select an active conversation');
      const frame=await workspace.frame(ownerId(agent),url.searchParams.get('browserId'),{after:Number(url.searchParams.get('after')??0),signal:request.signal});
      return Response.json(frame,{headers});
    }catch(error){
      if(['BROWSER_CLOSED','BROWSER_FRAME_PENDING'].includes(error.code))return Response.json({closed:error.code==='BROWSER_CLOSED',pending:error.code==='BROWSER_FRAME_PENDING'},{headers});
      return Response.json({error:error.message,code:error.code},{status:error.name==='AbortError'?499:404,headers});
    }
  }});
  register({ path: "/api/dsh-remote-ops/browser/screenshot", methods: ["GET"], fetch: async request => {
    try {
      const url = new URL(request.url), agent = ctx.agents.get(url.searchParams.get("sessionId"));
      if (!agent) throw browserError("BROWSER_OWNER_REQUIRED", "Select an active conversation");
      const record = workspace.session(ownerId(agent), url.searchParams.get("browserId"));
      if (!record.screenshot) throw browserError("BROWSER_SCREENSHOT_MISSING", "Capture a screenshot first");
      return new Response(record.screenshot.buffer, { headers: { ...headers, "Content-Type": "image/png", "X-Content-Type-Options": "nosniff" } });
    } catch (error) { return Response.json({ error: error.message }, { status: 404, headers }); }
  } });
}
