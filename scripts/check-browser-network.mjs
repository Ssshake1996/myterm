// strace -f -e trace=network logs only addresses from synthetic acceptance data.
import {readFile,writeFile} from 'node:fs/promises';
const path=process.argv[2];if(!path)throw Error('Pass a strace network log');
const source=await readFile(path,'utf8');
const attempts=[];
for(const line of source.split('\n')){
  if(!/\b(connect|sendto|sendmsg)\(/.test(line))continue;
  const addresses=[...line.matchAll(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/g)].map(m=>m[1]??m[2]);
  for(const address of addresses){if(!address.startsWith('127.')&&address!=='::1')attempts.push({address,operation:line.slice(0,600)});}
}
const report={scope:'Observed connect/sendto/sendmsg IPv4/IPv6 destinations in this isolated test',osIsolation:'Linux network namespace with loopback only',publicOrNonLoopbackAttempts:attempts,passed:attempts.length===0};
await writeFile(path+'.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(attempts.length)process.exitCode=1;
