import { createServer } from 'node:net';

// Loopback-only test device. This parser is intentionally independent of the plugin.
export async function startTelnetDevice({mode='username-password',username='operator',password='local-telnet-fixture-password'}={}) {
  const sockets=new Set(), commands=[], stats={connections:0,logins:0,passwordAttempts:0,windows:[]};
  const server=createServer(socket=>{
    stats.connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let phase=mode==='none'?'command':mode==='password'?'password':'username', line='',state=0,sub=[];
    socket.write(Buffer.from([255,251,1,255,251,3,255,253,31,255,253,24]));
    const prompt=()=>socket.write(phase==='username'?'Username: ':phase==='password'?'Password: ':'\r\nlab-switch> ');
    prompt();
    const enter=()=>{
      const text=line;line='';
      if(phase==='username'){if(text!==username){socket.write('\r\nLogin incorrect\r\n');prompt();return;}phase='password';socket.write('\r\n');prompt();return;}
      if(phase==='password'){stats.passwordAttempts++;if(text!==password){socket.write('\r\nLogin incorrect\r\n');prompt();return;}stats.logins++;phase='command';socket.write('\r\nWelcome to isolated Telnet device\r\n');prompt();return;}
      commands.push(text);
      socket.write('\r\n'+(text==='show version'?'TELNET_AGENT_VERIFIED version 1.0':text==='show human'?'TELNET_HUMAN_VERIFIED':text==='show after'?'TELNET_HOT_RELOAD_VERIFIED':text==='show 中文'?'中文显示正确':'result: '+text)+'\r\n');prompt();
    };
    socket.on('data',bytes=>{
      const plain=[];
      for(const b of bytes){
        if(state===0){if(b===255)state=1;else plain.push(b);}
        else if(state===1){if(b===250){sub=[];state=3;}else if([251,252,253,254].includes(b))state=2;else{if(b===255)plain.push(b);state=0;}}
        else if(state===2)state=0;
        else if(state===3){if(b===255)state=4;else sub.push(b);}
        else if(state===4){if(b===240){if(sub[0]===31)stats.windows.push({cols:(sub[1]<<8)|sub[2],rows:(sub[3]<<8)|sub[4]});state=0;}else{if(b===255)sub.push(255);state=3;}}
      }
      const text=Buffer.from(plain).toString('utf8');
      for(const char of text){if(char==='\r')enter();else if(char==='\n'||char==='\0')continue;else if(char==='\u0003'){line='';socket.write('^C\r\n');prompt();}else if(char==='\u007f'||char==='\b'){line=line.slice(0,-1);socket.write('\b \b');}else{line+=char;if(phase!=='password')socket.write(char);}}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {host:'127.0.0.1',port:server.address().port,username,password,commands,stats,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
