import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';

const port=9340;const profile=path.join(os.tmpdir(),`poio-updater-smoke-${process.pid}`);const executable=path.resolve(process.env.POIO_UPDATE_EXECUTABLE??'apps/desktop/release/win-unpacked/POIO.exe');
const expectedVersion=process.env.POIO_EXPECTED_VERSION??JSON.parse(readFileSync(path.resolve('apps/desktop/package.json'),'utf8')).version;const expectUpdate=process.env.POIO_EXPECT_UPDATE==='1';const waitForDownload=process.env.POIO_WAIT_FOR_DOWNLOAD==='1';
const child=spawn(executable,[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`],{cwd:path.dirname(executable),windowsHide:true,stdio:'ignore'});let ws;let sequence=0;
const evaluate=(expression,timeoutMs=20000)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(new Error('CDP evaluate timeout')),timeoutMs);const listener=event=>{const message=JSON.parse(event.data);if(message.id!==id)return;clearTimeout(timer);ws.removeEventListener('message',listener);if(message.result?.exceptionDetails)reject(new Error(message.result.exceptionDetails.exception?.description??message.result.exceptionDetails.text));else resolve(message.result.result.value)};ws.addEventListener('message',listener);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});
try{
  const deadline=Date.now()+25000;let target;while(Date.now()<deadline&&!target){await new Promise(resolve=>setTimeout(resolve,300));try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(response=>response.json())).find(item=>item.type==='page'&&item.url.includes('index.html'))}catch{}}
  if(!target)throw new Error('packaged POIO renderer target not found');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  const status=await evaluate(`(async()=>{const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let index=0;index<${waitForDownload?720:120};index++){const value=await window.echodeck.update.status();if(${waitForDownload}?['downloaded','error'].includes(value.state):${expectUpdate}?!['idle','checking','up-to-date'].includes(value.state):!['idle','checking'].includes(value.state))return value;await sleep(250)}return window.echodeck.update.status()})()`,waitForDownload?190000:40000);
  if(expectUpdate){if(!['available','downloading','downloaded'].includes(status.state))throw new Error(`update was not detected: ${JSON.stringify(status)}`);if(status.version&&status.version!==expectedVersion)throw new Error(`unexpected update version: ${JSON.stringify(status)}`)}else if(status.state!=='up-to-date'||status.version!==expectedVersion)throw new Error(`unexpected updater state: ${JSON.stringify(status)}`);
  console.log(JSON.stringify({onlineUpdate:true,manifestReachable:true,updateDetected:expectUpdate,...status}));
}finally{ws?.close();child.kill();await new Promise(resolve=>setTimeout(resolve,1000));try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}}
