// Two loopback instances share labels, routes and test IDs, but assign different DOM IDs.
export function recordingDevice(variant) {
  const state = { saves: 0, wrongButton: 0, saved: null };
  const handle = async (req, res) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/device/')) return false;
    if (path === '/device/commit' && req.method === 'POST') {
      let data = '';
      for await (const chunk of req) data += chunk;
      const form = JSON.parse(data);
      state.saves++;
      state.saved = { name: form.name, gateway: form.gateway };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state.saved));
    } else if (path === '/device/draft' && req.method === 'POST') {
      state.wrongButton++;
      res.writeHead(204).end();
    } else if (path === '/device/settings') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>设备配置</title>
        <style>body{margin:16px;font:16px system-ui}label{display:block}input{display:block;height:30px}iframe{width:95%;height:260px;border:0}</style>
        <label for="host-${variant}">设备名称</label><input id="host-${variant}" autocomplete="off">
        <iframe id="frame-${variant}" name="network" title="网络设置" src="/device/network"></iframe></html>`);
    } else if (path === '/device/network') {
      const save = `<button id="apply-${variant}" data-testid="apply-network">保存</button>`;
      const draft = `<button id="draft-${variant}" data-testid="apply-draft">保存</button>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>网络设置</title>
        <label for="gateway-${variant}">管理网关</label><input id="gateway-${variant}">
        <section>${variant === 'A' ? save + draft : draft + save}</section>
        <output role="status" data-testid="save-status"></output>
        <script>
        document.querySelector('[data-testid="apply-network"]').onclick=async()=>{
          const name=parent.document.querySelector('input').value,gateway=document.querySelector('input').value;
          const response=await fetch('/device/commit',{method:'POST',body:JSON.stringify({name,gateway})});
          if(response.ok)document.querySelector('output').textContent='已保存 '+name+' · '+gateway;
        };
        document.querySelector('[data-testid="apply-draft"]').onclick=()=>fetch('/device/draft',{method:'POST'});
        </script></html>`);
    } else res.writeHead(404).end();
    return true;
  };
  return { handle, state };
}
