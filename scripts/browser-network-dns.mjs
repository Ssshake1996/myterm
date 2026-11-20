// Isolated CI resolver: record synthetic test queries and return NXDOMAIN.
// There is deliberately no forwarding or upstream DNS client.
import dgram from 'node:dgram';
import {appendFileSync,writeFileSync} from 'node:fs';
const directory=process.argv[2];if(!directory)throw Error('Pass evidence directory');
const socket=dgram.createSocket('udp4');
socket.on('message',(message,peer)=>{
  if(message.length<12||message.readUInt16BE(4)!==1)return;
  let offset=12;const labels=[];
  while(offset<message.length){const n=message[offset++];if(!n)break;if(n>63||offset+n>message.length)return;labels.push(message.subarray(offset,offset+n).toString('ascii'));offset+=n;}
  if(offset+4>message.length)return;
  appendFileSync(directory+'/dns-queries.ndjson',JSON.stringify({name:labels.join('.'),type:message.readUInt16BE(offset),result:'NXDOMAIN',forwarded:false})+'\n');
  const response=Buffer.from(message.subarray(0,offset+4));response.writeUInt16BE(0x8183,2);
  response.writeUInt16BE(0,6);response.writeUInt16BE(0,8);response.writeUInt16BE(0,10);
  socket.send(response,peer.port,peer.address);
});
socket.bind(53,'127.0.0.1',()=>writeFileSync(directory+'/dns-ready','ready'));
