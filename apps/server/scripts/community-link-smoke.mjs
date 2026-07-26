import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const runtime=mkdtempSync(path.join(os.tmpdir(),'poio-community-link-smoke-'));
const port=Number(process.env.POIO_LINK_SMOKE_PORT??19620);
const mediaPort=port+1000;
const debugPort=Number(process.env.POIO_LINK_SMOKE_DEBUG_PORT??9460);
const origin=`http://127.0.0.1:${port}`;
const desktop=path.resolve('apps/desktop');
const electronPath=path.resolve('node_modules/electron/dist/electron.exe');
const profile=path.join(runtime,'electron-profile');
const server=spawn(process.execPath,['apps/server/dist/index.js'],{
  cwd:path.resolve('.'),
  windowsHide:true,
  stdio:['ignore','pipe','pipe'],
  env:{
    ...process.env,
    HOST:'127.0.0.1',
    PORT:String(port),
    PUBLIC_IP:'127.0.0.1',
    PUBLIC_APP_URL:`${origin}/poio`,
    MEDIASOUP_PORT:String(mediaPort),
    MEDIASOUP_MIN_PORT:String(mediaPort+1),
    MEDIASOUP_MAX_PORT:String(mediaPort+50),
    DATABASE_PATH:path.join(runtime,'poio.db'),
    BACKUP_PATH:path.join(runtime,'backups'),
    UPLOAD_PATH:path.join(runtime,'uploads'),
    DOWNLOAD_PATH:path.resolve('deploy/download'),
    RELEASE_PATH:path.join(runtime,'releases')
  }
});
let serverOutput='';
server.stdout.on('data',chunk=>serverOutput+=chunk);
server.stderr.on('data',chunk=>serverOutput+=chunk);
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const sockets=[];
let electron;
let second;
let ws;
let sequence=0;

const connect=async()=>{
  const socket=io(origin,{path:'/socket.io',transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
  sockets.push(socket);
  return socket;
};
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),10_000);
  socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))});
});
const evaluate=(expression,timeoutMs=30_000)=>new Promise((resolve,reject)=>{
  const id=++sequence;
  const timer=setTimeout(()=>reject(new Error('CDP evaluate timeout')),timeoutMs);
  const listener=event=>{
    const message=JSON.parse(event.data);
    if(message.id!==id)return;
    clearTimeout(timer);
    ws.removeEventListener('message',listener);
    if(message.error)reject(new Error(message.error.message));
    else if(message.result?.exceptionDetails)reject(new Error(message.result.exceptionDetails.exception?.description??message.result.exceptionDetails.text));
    else resolve(message.result?.result?.value);
  };
  ws.addEventListener('message',listener);
  ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
});
const setInput=(index,value)=>`(()=>{const input=document.querySelectorAll('.auth-card input')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`;

try{
  const deadline=Date.now()+20_000;
  let ready=false;
  while(Date.now()<deadline){
    if(server.exitCode!==null)throw new Error(`local server exited ${server.exitCode}: ${serverOutput}`);
    try{if((await fetch(`${origin}/health`).then(response=>response.json())).ok){ready=true;break}}catch{}
    await wait(200);
  }
  if(!ready)throw new Error(`local server did not start: ${serverOutput}`);

  const owner=await connect();
  const guest=await connect();
  const suffix=Date.now().toString(36);
  const ownerAuth=await request(owner,'auth:register',{username:`link_owner_${suffix}`,password:`Owner-${suffix}-secure`});
  const guestName=`link_guest_${suffix}`;
  const guestPassword=`Guest-${suffix}-secure`;
  await request(guest,'auth:register',{username:guestName,password:guestPassword});
  const invite=await request(owner,'space:invite',{spaceId:ownerAuth.bootstrap[0].id});
  const preview=await fetch(`${origin}/api/invites/${invite.code}`).then(response=>response.json());
  const landing=await fetch(`${origin}/invite/${invite.code}`).then(response=>response.text());
  if(preview.spaceId!==ownerAuth.bootstrap[0].id||preview.url!==`${origin}/poio/invite/${invite.code}`||!landing.includes('在 POIO 中打开')||!landing.includes('poio://invite/'))throw new Error(`invite web flow failed: ${JSON.stringify({preview,landing:landing.slice(0,100)})}`);

  electron=spawn(electronPath,[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,desktop,`poio://invite/${invite.code}`],{
    cwd:desktop,
    windowsHide:true,
    stdio:'ignore',
    env:{...process.env,POIO_DISABLE_PROTOCOL_REGISTRATION:'1'}
  });
  let target;
  const rendererDeadline=Date.now()+20_000;
  while(Date.now()<rendererDeadline&&!target){
    await wait(300);
    try{target=(await fetch(`http://127.0.0.1:${debugPort}/json`).then(response=>response.json())).find(item=>item.type==='page'&&item.url.includes('index.html'))}catch{}
  }
  if(!target)throw new Error('Electron renderer target not found');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});

  const authBanner=await evaluate(`(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<100&&!document.querySelector('.auth-invite b');i++)await sleep(100);return document.querySelector('.auth-invite b')?.textContent??''})()`);
  if(authBanner!==ownerAuth.bootstrap[0].name)throw new Error(`invite was not preserved before login: ${authBanner}`);
  await evaluate(setInput(0,guestName));
  await evaluate(setInput(1,guestPassword));
  await evaluate(`document.querySelector('.auth-card button.primary').click()`);
  const confirmation=await evaluate(`(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<120&&!document.querySelector('.incoming-invite');i++)await sleep(100);return {name:document.querySelector('.incoming-invite h2')?.textContent??'',action:document.querySelector('.incoming-invite footer .primary')?.textContent??''}})()`);
  if(confirmation.name!==ownerAuth.bootstrap[0].name||confirmation.action!=='确认加入社区')throw new Error(`invite confirmation missing after login: ${JSON.stringify(confirmation)}`);
  await evaluate(`document.querySelector('.incoming-invite footer .primary').click()`);
  const joined=await evaluate(`(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<100&&document.querySelector('.space-head strong')?.textContent!==${JSON.stringify(ownerAuth.bootstrap[0].name)};i++)await sleep(100);return {space:document.querySelector('.space-head strong')?.textContent??'',modal:Boolean(document.querySelector('.incoming-invite'))}})()`);
  if(joined.space!==ownerAuth.bootstrap[0].name||joined.modal)throw new Error(`invite join did not switch community: ${JSON.stringify(joined)}`);

  second=spawn(electronPath,[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,desktop,`poio://invite/${invite.code}`],{
    cwd:desktop,
    windowsHide:true,
    stdio:'ignore',
    env:{...process.env,POIO_DISABLE_PROTOCOL_REGISTRATION:'1'}
  });
  const alreadyJoined=await evaluate(`(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<100&&!document.querySelector('.incoming-invite');i++)await sleep(100);return {text:document.querySelector('.incoming-invite p')?.textContent??'',action:document.querySelector('.incoming-invite footer .primary')?.textContent??''}})()`);
  if(!alreadyJoined.text.includes('已经是这个社区的成员')||alreadyJoined.action!=='打开社区')throw new Error(`second-instance invite was not handled: ${JSON.stringify(alreadyJoined)}`);
  const guestSpaces=await request(guest,'auth:login',{username:guestName,password:guestPassword});
  if(!guestSpaces.bootstrap.some(space=>space.id===ownerAuth.bootstrap[0].id))throw new Error('joined community was not persisted');

  console.log(JSON.stringify({
    communityLink:true,
    landingPage:true,
    publicPreview:true,
    pendingBeforeLogin:true,
    joinedAfterLogin:true,
    secondInstance:true,
    alreadyJoined:true,
    inviteCode:invite.code
  }));
}finally{
  ws?.close();
  for(const socket of sockets)socket.close();
  if(second?.pid)spawnSync('taskkill.exe',['/PID',String(second.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  if(electron?.pid)spawnSync('taskkill.exe',['/PID',String(electron.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  if(server.pid)spawnSync('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  await wait(500);
  rmSync(runtime,{recursive:true,force:true,maxRetries:8,retryDelay:200});
}
