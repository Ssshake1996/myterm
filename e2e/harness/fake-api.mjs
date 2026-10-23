import http from 'node:http';
export async function startApi({port=0}={}) {
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const auth=req.headers.authorization==='Bearer fixture-token'||req.headers.cookie?.includes('session=fixture-cookie');
    calls.push({path:req.url,method:req.method,authenticated:!!auth});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/login'||req.url==='/api/cookie-login') {
      const body=req.headers['content-type']?.includes('form')?Object.fromEntries(new URLSearchParams(text)):JSON.parse(text||'{}');
      if(body.username!=='tester'||body.password!=='api-fixture-password'){res.statusCode=401;return res.end('{"error":"invalid credentials"}');}
      if(req.url.includes('cookie-login')){res.setHeader('Set-Cookie',['session=fixture-cookie; HttpOnly; Path=/api','csrf=fixture-csrf; Path=/api']);return res.end('{"success":true}');}
      return res.end('{"data":{"token":"fixture-token"},"success":true}');
    }
    if(!auth||req.url==='/api/expired'){res.statusCode=401;return res.end('{"error":"login required"}');}
    if(req.url==='/api/slow')await new Promise(resolve=>setTimeout(resolve,1600));
    res.end(JSON.stringify({success:true,items:[{id:'device-01',name:'Test appliance',state:'healthy'}],method:req.method,path:req.url,csrf:!!req.headers['x-csrf-token']}));
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/api`,calls,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
