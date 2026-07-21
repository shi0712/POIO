import { spawn } from 'node:child_process';
import path from 'node:path';

const desktop=path.resolve('apps/desktop');
const electronPath=path.resolve('node_modules/electron/dist/electron.exe');
const port=9337;
const child=spawn(electronPath,[`--remote-debugging-port=${port}`,desktop],{cwd:desktop,windowsHide:true,stdio:'ignore'});
let ws;let sequence=0;
const evaluate=(expression,timeoutMs=30000)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(new Error('CDP evaluate timeout')),timeoutMs);const listener=event=>{const message=JSON.parse(event.data);if(message.id!==id)return;clearTimeout(timer);ws.removeEventListener('message',listener);if(message.result?.exceptionDetails)reject(new Error(message.result.exceptionDetails.exception?.description??message.result.exceptionDetails.text));else resolve(message.result.result.value)};ws.addEventListener('message',listener);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});
try{
  const deadline=Date.now()+20000;let target;while(Date.now()<deadline&&!target){await new Promise(resolve=>setTimeout(resolve,250));try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(response=>response.json())).find(item=>item.type==='page'&&item.url.includes('index.html'))}catch{}}
  if(!target)throw new Error('Electron renderer target not found');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  const result=await evaluate(`(async()=>{const sources=await window.echodeck.getDesktopSources();const source=sources.find(item=>item.id.startsWith('screen:'))??sources[0];if(!source)throw new Error('no desktop source');const capture=navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:source.id}},video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:source.id,maxFrameRate:30}}});const stream=await Promise.race([capture,new Promise((_,reject)=>setTimeout(()=>reject(new Error('getUserMedia timeout')),20000))]);const value={source:source.name,audio:stream.getAudioTracks().map(track=>({label:track.label,readyState:track.readyState,settings:track.getSettings()})),video:stream.getVideoTracks().map(track=>({label:track.label,readyState:track.readyState,settings:track.getSettings()}))};stream.getTracks().forEach(track=>track.stop());return value})()`,30000);
  if(result.audio.length<1||result.video.length<1)throw new Error(`missing capture track: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({desktopCapture:true,...result}));
}finally{ws?.close();child.kill()}
