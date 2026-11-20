// strace -f -e trace=network logs only addresses from synthetic acceptance data.
import {readFile,writeFile} from 'node:fs/promises';
const path=process.argv[2];if(!path)throw Error('Pass a strace network log');
const source=await readFile(path,'utf8');
const attempts=[],blockedChromiumIpv6Probes=[],unexpected=[],sockets=new Map(),pending=new Map();let inspectedDestinations=0;
for(let line of source.split('\n')){
  // Join strace's interleaved unfinished/resumed syscalls before checking results.
  const prefix=line.match(/^(\d+)\s+/);const pid=prefix?.[1]??'single';
  if(line.includes('<unfinished ...>')){pending.set(pid,line.replace('<unfinished ...>',''));continue;}
  if(line.includes('<... ')){const start=pending.get(pid);pending.delete(pid);if(!start)continue;line=start+line.replace(/^.*?resumed>/,'');}
  const socket=line.match(/socket\(AF_INET6, SOCK_DGRAM[^)]*\)\s*=\s*(\d+)/);
  if(socket)sockets.set(pid+':'+socket[1],'udp6');
  const closed=line.match(/close\((\d+)\)\s*=\s*0/);if(closed)sockets.delete(pid+':'+closed[1]);
  const operation=line.match(/\b(connect|sendto|sendmsg|sendmmsg)\((\d+)/);if(!operation)continue;
  const addresses=[...line.matchAll(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/g)].map(m=>m[1]??m[2]);
  for(const address of addresses){
    inspectedDestinations++;if(/^127\./.test(address)||address==='::1'||/^::ffff:127\./.test(address))continue;
    const entry={address,operation:line.slice(0,600)};attempts.push(entry);
    // Chromium's documented UDP route check does not send application data.
    // Keep it visible, and allow ONLY a verified UDP6 connect rejected by the OS.
    // https://github.com/chromium/chromium/blob/main/net/dns/README.md#ipv6-and-connectivity
    const probe=address==='2001:4860:4860::8888'&&operation[1]==='connect'&&sockets.get(pid+':'+operation[2])==='udp6'&&/sin6_port=htons\(443\)/.test(line)&&/= -1 ENETUNREACH\b/.test(line);
    (probe?blockedChromiumIpv6Probes:unexpected).push(entry);
  }
}
const report={scope:'Observed connect/sendto/sendmsg/sendmmsg IPv4/IPv6 destinations in this isolated test',osIsolation:process.env.REMOTE_OPS_NETWORK_ISOLATION??'see isolation-probe.txt and routes.txt',inspectedDestinations,publicOrNonLoopbackAttempts:attempts,blockedChromiumIpv6Probes,unexpectedNonLoopbackAttempts:unexpected,passed:inspectedDestinations>0&&unexpected.length===0};
await writeFile(path+'.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
