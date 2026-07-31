import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const debugPort=Number(process.env.POIO_PTT_SMOKE_PORT??9337);
const socket=io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});
const request=(event,payload={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15_000);
  socket.emit(event,payload,(reply)=>{
    clearTimeout(timer);
    reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`));
  });
});
const wait=(milliseconds)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function evaluate(target,expression,timeout=30_000){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(target.webSocketDebuggerUrl);
    const timer=setTimeout(()=>{ws.close();reject(new Error('CDP timeout'))},timeout);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    ws.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.id!==1)return;
      clearTimeout(timer);
      ws.close();
      if(message.result?.exceptionDetails)reject(new Error(message.result.exceptionDetails.exception?.description??message.result.exceptionDetails.text));
      else resolve(message.result.result.value);
    };
    ws.onerror=()=>{clearTimeout(timer);reject(new Error('CDP websocket failed'))};
  });
}

function pulseVKey(){
  const source=`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PoioPttSmokeKey {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
[PoioPttSmokeKey]::keybd_event(0x56,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 1100
[PoioPttSmokeKey]::keybd_event(0x56,0,2,[UIntPtr]::Zero)
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',source],{windowsHide:true,encoding:'utf8'});
  if(result.status!==0)throw new Error(`Synthetic PTT key failed: ${result.stderr||result.stdout}`);
}

await new Promise((resolve,reject)=>{
  socket.once('connect',resolve);
  socket.once('connect_error',reject);
});

const suffix=Date.now().toString(36);
const auth=await request('auth:register',{username:`ptt_${suffix}`,password:`Test-${suffix}-secure`});
const voice=auth.bootstrap[0].channels.find(channel=>channel.kind==='voice');
if(!voice)throw new Error('Smoke community has no voice channel');
const credentials=await request('voice:credentials',{channelId:voice.id});
const desktop=path.resolve('apps/desktop');
const packagedPath=process.env.ECHODECK_DESKTOP_EXE?path.resolve(process.env.ECHODECK_DESKTOP_EXE):'';
const electronPath=packagedPath||path.resolve('node_modules/electron/dist/electron.exe');
const profile=await mkdtemp(path.join(tmpdir(),'poio-ptt-smoke-'));
const child=spawn(electronPath,[`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,...(packagedPath?[]:[desktop])],{
  cwd:packagedPath?path.dirname(packagedPath):desktop,
  windowsHide:true,
  stdio:'ignore'
});

try {
  const deadline=Date.now()+20_000;
  let target;
  while(Date.now()<deadline&&!target){
    await wait(350);
    try{
      const targets=await fetch(`http://127.0.0.1:${debugPort}/json`).then(response=>response.json());
      target=targets.find(item=>item.type==='page'&&item.url.includes('index.html'));
    }catch{}
  }
  if(!target)throw new Error('Electron renderer target not found');

  const connected=await evaluate(target,`(async()=>{
    window.__poioPttEvents=[];
    window.__removePoioPttListener=window.echodeck.mumble.onControls(value=>window.__poioPttEvents.push({...value,time:Date.now()}));
    window.__poioPreviousPreferences=await window.echodeck.preferences.get();
    await window.echodeck.preferences.set({
      pushToTalkEnabled:true,
      pushToTalkShortcut:{virtualKey:86,modifiers:0,label:'V'}
    });
    const joined=await window.echodeck.mumble.connect(${JSON.stringify(credentials)});
    await new Promise(resolve=>setTimeout(resolve,1800));
    const status=await window.echodeck.mumble.command('STATUS');
    return {joined,status};
  })()`);

  pulseVKey();
  await wait(900);

  const observed=await evaluate(target,`(async()=>{
    const status=await window.echodeck.mumble.command('STATUS');
    const events=window.__poioPttEvents??[];
    await window.echodeck.preferences.set({
      pushToTalkEnabled:window.__poioPreviousPreferences.pushToTalkEnabled,
      pushToTalkShortcut:window.__poioPreviousPreferences.pushToTalkShortcut
    });
    window.__removePoioPttListener?.();
    await window.echodeck.mumble.disconnect();
    return {status,events};
  })()`);

  const active=observed.events.find(event=>event.pushToTalkActive===true);
  const transmitting=observed.events.find(event=>event.transmitting===true);
  const settled=observed.events.slice().reverse().find(event=>event.pushToTalkActive===false&&event.transmitting===false);
  if(!active)throw new Error(`PTT active state was not observed: ${JSON.stringify(observed.events)}`);
  if(!transmitting)throw new Error(`Native transmitting state was not observed: ${JSON.stringify(observed.events)}`);
  if(!settled||settled.time<Math.max(active.time,transmitting.time))throw new Error(`PTT state did not settle after release: ${JSON.stringify(observed.events)}`);

  console.log(JSON.stringify({
    electronPttState:true,
    initialStatus:connected.status,
    finalStatus:observed.status,
    events:observed.events
  }));
} finally {
  if(child.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  socket.close();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
