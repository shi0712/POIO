import { spawn } from 'node:child_process';
import path from 'node:path';
import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const socket=io(origin,{path:'/echodeck/socket.io',transports:['websocket'],reconnection:false});
const request=(event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});

const suffix=Date.now().toString(36);
const auth=await request('auth:register',{username:`recover_${suffix}`,password:`Test-${suffix}-secure`});
const voice=auth.bootstrap[0].channels.find(channel=>channel.kind==='voice');
if(!voice)throw new Error('smoke account has no voice channel');
const credentials=await request('voice:credentials',{channelId:voice.id});
const desktop=path.resolve('apps/desktop');
const packagedPath=process.env.ECHODECK_DESKTOP_EXE?path.resolve(process.env.ECHODECK_DESKTOP_EXE):'';
const electronPath=packagedPath||path.resolve('node_modules/electron/dist/electron.exe');
const debugPort=9339;
const child=spawn(electronPath,[`--remote-debugging-port=${debugPort}`,...(packagedPath?[]:[desktop])],{cwd:packagedPath?path.dirname(packagedPath):desktop,windowsHide:true,stdio:'ignore'});
let target;

const evaluate=expression=>new Promise((resolve,reject)=>{
  const ws=new WebSocket(target.webSocketDebuggerUrl);const id=Math.floor(Math.random()*1e9);const timer=setTimeout(()=>{ws.close();reject(new Error('CDP evaluate timeout'))},30000);
  ws.onopen=()=>ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id!==id)return;clearTimeout(timer);ws.close();if(message.result?.exceptionDetails)reject(new Error(message.result.exceptionDetails.exception?.description??message.result.exceptionDetails.text));else resolve(message.result.result.value)};
  ws.onerror=()=>{clearTimeout(timer);reject(new Error('CDP websocket failed'))};
});
const readPid=async()=>{const diagnostics=await evaluate('window.echodeck.diagnostics()');const match=/Mumble PID:\s*(\d+)/.exec(diagnostics);return match?Number(match[1]):0};

try{
  const deadline=Date.now()+20000;
  while(Date.now()<deadline&&!target){await new Promise(resolve=>setTimeout(resolve,300));try{const targets=await fetch(`http://127.0.0.1:${debugPort}/json`).then(response=>response.json());target=targets.find(item=>item.type==='page'&&item.url.includes('index.html'))}catch{}}
  if(!target)throw new Error('Electron renderer target not found');
  await evaluate(`window.echodeck.mumble.connect(${JSON.stringify(credentials)})`);
  await evaluate("window.echodeck.mumble.command('MUTE 1')");
  await evaluate("window.echodeck.mumble.command('DEAF 1')");
  const firstPid=await readPid();if(!firstPid)throw new Error('initial Mumble PID missing');
  process.kill(firstPid);
  let sawReconnecting=false;let finalState;let status='';let secondPid=0;
  const recoveryDeadline=Date.now()+30000;
  while(Date.now()<recoveryDeadline){
    await new Promise(resolve=>setTimeout(resolve,180));
    finalState=await evaluate('window.echodeck.mumble.state()');
    if(finalState?.state==='reconnecting')sawReconnecting=true;
    if(finalState?.state==='connected'){
      try{status=await evaluate("window.echodeck.mumble.command('STATUS')");secondPid=await readPid();if(/connected=1 muted=1 deafened=1/.test(status)&&secondPid&&secondPid!==firstPid)break}catch{}
    }
  }
  if(!sawReconnecting)throw new Error(`reconnecting state was not observed: ${JSON.stringify(finalState)}`);
  if(!/connected=1 muted=1 deafened=1/.test(status)||!secondPid||secondPid===firstPid)throw new Error(`Mumble did not recover with privacy controls preserved: ${JSON.stringify({firstPid,secondPid,finalState,status})}`);
  await evaluate('(()=>{void window.echodeck.window.close();return true})()');
  const gracefulClose=await Promise.race([new Promise(resolve=>child.once('exit',()=>resolve(true))),new Promise(resolve=>setTimeout(()=>resolve(false),8000))]);
  if(!gracefulClose)throw new Error('POIO did not close cleanly while Mumble was active');
  console.log(JSON.stringify({mumbleAutoRecovery:true,sawReconnecting,firstPid,secondPid,finalState,status,gracefulClose}));
}finally{
  try{if(target&&child.exitCode===null)await evaluate('window.echodeck.mumble.disconnect()')}catch{}
  if(child.exitCode===null)child.kill();socket.close();
}
