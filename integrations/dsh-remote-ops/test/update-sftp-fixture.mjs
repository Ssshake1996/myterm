// Real SSH2/SFTP protocol against a temporary release directory; no device commands.
import ssh2 from "ssh2";
import { generateKeyPairSync } from "node:crypto";
import { stat, open, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";

export async function startUpdateSftp(root, { username = "updater", password = "update-test-password" } = {}) {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
  const clients = new Set(), requests = [], handles = new Map(); let sequence = 0;
  const local = path => {
    if (!path.startsWith("/releases")) throw Error("outside fixture");
    const full=resolve(root,"."+path.slice("/releases".length)), delta=relative(root,full);
    if(delta.startsWith('..')||isAbsolute(delta))throw Error('outside fixture');return full;
  };
  const attrs = value => ({ mode:value.mode,uid:0,gid:0,size:value.size,atime:Math.floor(value.atimeMs/1000),mtime:Math.floor(value.mtimeMs/1000) });
  const server=new ssh2.Server({hostKeys:[key]},client=>{
    clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
    client.on('authentication',ctx=>ctx.method==='password'&&ctx.username===username&&ctx.password===password?ctx.accept():ctx.reject());
    client.on('ready',()=>client.on('session',accept=>accept().on('sftp',accept=>{
      const stream=accept();stream.on('error',()=>{});
      const operation=(event,fn)=>stream.on(event,(id,...args)=>{requests.push({event,path:typeof args[0]==='string'?args[0]:undefined});Promise.resolve().then(()=>fn(id,...args)).catch(()=>{if(!stream.destroyed)stream.status(id,2);});});
      operation('REALPATH',async(id,path)=>{const actual=await realpath(local(path)),remote='/releases/'+relative(root,actual).split(sep).join('/');stream.name(id,[{filename:remote.replace(/\/$/,''),longname:remote,attrs:attrs(await stat(actual))}]);});
      for(const event of ['STAT','LSTAT'])operation(event,async(id,path)=>stream.attrs(id,attrs(await stat(local(path)))));
      operation('OPEN',async(id,path,flags)=>{if(flags!==1)return stream.status(id,3);const file=await open(local(path),'r'),handle=Buffer.from(String(++sequence));handles.set(handle.toString(),file);stream.handle(id,handle);});
      operation('READ',async(id,handle,offset,length)=>{const file=handles.get(handle.toString());if(!file)return stream.status(id,4);const buffer=Buffer.alloc(Math.min(length,65536));const result=await file.read(buffer,0,buffer.length,offset);if(result.bytesRead)stream.data(id,buffer.subarray(0,result.bytesRead));else stream.status(id,1);});
      operation('CLOSE',async(id,handle)=>{const file=handles.get(handle.toString());handles.delete(handle.toString());await file?.close();stream.status(id,0);});
    })));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {host:'127.0.0.1',port:server.address().port,username,password,requests,close:async()=>{for(const client of clients)client.end();for(const file of handles.values())await file.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));}};
}
