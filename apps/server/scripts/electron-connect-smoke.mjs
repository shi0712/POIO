import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const socket=io(origin,{path:'/echodeck/socket.io',transports:['websocket'],reconnection:false});
const request=(event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,(reply)=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});

const suffix=Date.now().toString(36);
const auth=await request('auth:register',{username:`electron_${suffix}`,password:`Test-${suffix}-secure`});
const voice=auth.bootstrap[0].channels.find(channel=>channel.kind==='voice');
const credentials=await request('voice:credentials',{channelId:voice.id});
const desktop=path.resolve('apps/desktop');
const electronPath=path.resolve('node_modules/electron/dist/electron.exe');
const profile=path.join(os.tmpdir(),`poio-electron-connect-smoke-${process.pid}`);
const child=spawn(electronPath,['--remote-debugging-port=9334',`--user-data-dir=${profile}`,desktop],{cwd:desktop,windowsHide:true,stdio:'ignore'});

try {
  const deadline=Date.now()+20000;let target;
  while(Date.now()<deadline&&!target){
    await new Promise(resolve=>setTimeout(resolve,350));
    try{const targets=await fetch('http://127.0.0.1:9334/json').then(response=>response.json());target=targets.find(item=>item.type==='page'&&item.url.includes('index.html'))}catch{}
  }
  if(!target)throw new Error('Electron renderer target not found');
  const result=await new Promise((resolve,reject)=>{
    const ws=new WebSocket(target.webSocketDebuggerUrl);const timer=setTimeout(()=>reject(new Error('CDP timeout')),30000);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`(async()=>{const connection=${JSON.stringify(credentials)};const joined=await Promise.all([window.echodeck.mumble.connect(connection),window.echodeck.mumble.connect(connection)]);const concurrent=await Promise.all([window.echodeck.mumble.devices(),window.echodeck.mumble.volumes(),window.echodeck.mumble.level(),window.echodeck.mumble.devices(),window.echodeck.mumble.volumes(),window.echodeck.mumble.level()]);await window.echodeck.mumble.command('MUTE 1');await window.echodeck.mumble.command('DEAF 1');const duplicate=await window.echodeck.mumble.connect(connection);const status=await window.echodeck.mumble.command('STATUS');if(!/muted=1 deafened=1/.test(status))throw new Error('duplicate connect changed audio controls: '+status);await window.echodeck.mumble.disconnect();return {joined,duplicate,status,inputs:concurrent[0].inputs.length,outputs:concurrent[0].outputs.length,inputVolume:concurrent[1].input,outputVolume:concurrent[1].output,levels:[concurrent[2],concurrent[5]]}})()`,awaitPromise:true,returnByValue:true}}));
    ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id!==1)return;clearTimeout(timer);ws.close();if(message.result?.exceptionDetails)reject(new Error(message.result.exceptionDetails.exception?.description??message.result.exceptionDetails.text));else resolve(message.result.result.value)};
    ws.onerror=()=>reject(new Error('CDP websocket failed'));
  });
  console.log(JSON.stringify({electronConnect:true,...result}));
} finally {
  child.kill();socket.close();
  await new Promise(resolve=>setTimeout(resolve,500));
  rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
