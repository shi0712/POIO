import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(serverRoot,'../..');
const testRoot=path.join(root,'.tmp-p2p-test');
if(path.dirname(testRoot)!==root||path.basename(testRoot)!=='.tmp-p2p-test')throw new Error('unsafe P2P test directory');
rmSync(testRoot,{recursive:true,force:true});
mkdirSync(testRoot,{recursive:true});

const server=spawn(process.execPath,['dist/index.js'],{
  cwd:serverRoot,
  windowsHide:true,
  stdio:['ignore','pipe','pipe'],
  env:{
    ...process.env,
    HOST:'127.0.0.1',
    PORT:'18920',
    PUBLIC_IP:'127.0.0.1',
    DATABASE_PATH:path.join(testRoot,'poio.db'),
    BACKUP_PATH:path.join(testRoot,'backups'),
    UPLOAD_PATH:path.join(testRoot,'uploads'),
    DOWNLOAD_PATH:path.join(root,'deploy/download'),
    RELEASE_PATH:path.join(testRoot,'releases'),
    MEDIASOUP_PORT:'18921',
    MEDIASOUP_MIN_PORT:'48900',
    MEDIASOUP_MAX_PORT:'48920'
  }
});
let stderr='';
server.stderr.on('data',chunk=>stderr+=chunk.toString());

try {
  let ready=false;
  for(let attempt=0;attempt<40;attempt++) {
    try {
      const health=await fetch('http://127.0.0.1:18920/health').then(response=>response.json());
      if(health.ok){ready=true;break}
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw new Error(`local POIO server did not start\n${stderr}`);
  const smoke=spawn(process.execPath,['scripts/p2p-signaling-smoke.mjs'],{
    cwd:serverRoot,windowsHide:true,stdio:'inherit',
    env:{...process.env,POIO_SMOKE_URL:'http://127.0.0.1:18920',POIO_SOCKET_PATH:'/socket.io'}
  });
  const code=await new Promise((resolve,reject)=>{smoke.once('exit',resolve);smoke.once('error',reject)});
  if(code!==0)throw new Error(`P2P signaling smoke exited with ${code}`);
} finally {
  if(server.exitCode===null) {
    server.kill();
    await new Promise(resolve=>server.once('exit',resolve));
  }
  rmSync(testRoot,{recursive:true,force:true});
}
