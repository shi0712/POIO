import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

const executable=path.resolve(
  process.argv[2]??path.join(
    import.meta.dirname,
    '..',
    'build-mediasoup',
    'poio-share-sidecar.exe',
  ),
);
if(!existsSync(executable))throw new Error(`Sidecar not found: ${executable}`);

const child=spawn(executable,[],{
  cwd:path.dirname(executable),
  windowsHide:true,
  stdio:['pipe','pipe','pipe'],
});
child.stderr.setEncoding('utf8');
let stderr='';
child.stderr.on('data',chunk=>{stderr=`${stderr}${chunk}`.slice(-8_192)});

let nextId=1;
const pending=new Map();
const requests=[];
const events=[];
const lines=readline.createInterface({input:child.stdout});
lines.on('line',line=>{
  const message=JSON.parse(line);
  if(message.type==='response'){
    const waiter=pending.get(String(message.id));
    if(!waiter)return;
    pending.delete(String(message.id));
    clearTimeout(waiter.timer);
    if(message.ok)waiter.resolve(message.result);
    else waiter.reject(new Error(message.error||'Sidecar command failed'));
    return;
  }
  if(message.type==='request'){
    requests.push(message.request);
    const result=message.request==='sfu.produce'
      ?{id:'poio-sidecar-smoke-producer'}
      :true;
    child.stdin.write(`${JSON.stringify({
      method:'resolve',
      params:{requestId:message.requestId,ok:true,result},
    })}\n`);
    return;
  }
  if(message.type==='event')events.push(message);
});

function command(method,params={}){
  const id=String(nextId++);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    },20_000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(`${JSON.stringify({id,method,params})}\n`);
  });
}

function delay(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function waitForEvent(predicate,timeoutMs=5_000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const match=events.find(predicate);
    if(match)return match;
    await delay(25);
  }
  throw new Error('Timed out waiting for a sidecar event');
}

const routerRtpCapabilities={
  codecs:[
    {
      kind:'video',
      mimeType:'video/H264',
      preferredPayloadType:103,
      clockRate:90000,
      parameters:{
        'packetization-mode':1,
        'level-asymmetry-allowed':1,
        'profile-level-id':'42e01f',
      },
      rtcpFeedback:[
        {type:'nack'},
        {type:'nack',parameter:'pli'},
        {type:'ccm',parameter:'fir'},
        {type:'goog-remb'},
        {type:'transport-cc'},
      ],
    },
    {
      kind:'video',
      mimeType:'video/rtx',
      preferredPayloadType:104,
      clockRate:90000,
      parameters:{apt:103},
      rtcpFeedback:[],
    },
  ],
  headerExtensions:[],
};

const transport={
  id:'poio-sidecar-smoke-transport',
  iceParameters:{
    iceLite:true,
    usernameFragment:'poiotest',
    password:'poio-test-password-123456789',
  },
  iceCandidates:[{
    foundation:'poio',
    priority:1078862079,
    ip:'127.0.0.1',
    protocol:'udp',
    port:49000,
    type:'host',
  }],
  dtlsParameters:{
    role:'auto',
    fingerprints:[{
      algorithm:'sha-256',
      value:'A9:F4:E0:D2:74:D3:0F:D9:CA:A5:2F:9F:7F:47:FA:F0:C4:72:DD:73:49:D0:3B:14:90:20:51:30:1B:90:8E:71',
    }],
  },
};

try{
  const hello=await command('hello');
  if(hello.protocol!=='poio.share.ipc.v1')throw new Error('Unexpected sidecar protocol');
  const sources=await command('sources');
  const monitor=sources.find(source=>source.kind==='monitor'&&source.captureSupported);
  if(!monitor)throw new Error('No capturable monitor was reported');

  const started=await command('start',{
    sourceId:monitor.id,
    captureCursor:false,
    routerRtpCapabilities,
    transport,
    publish:{
      maxBitrateBps:12_000_000,
      maxFrameRate:60,
      appData:{mediaTag:'screen',profile:'fps',native:true},
    },
  });
  if(started.producerId!=='poio-sidecar-smoke-producer')
    throw new Error(`Unexpected producer id: ${started.producerId}`);
  await delay(1_000);
  const activeStats=await command('stats');
  if(!activeStats.running||activeStats.capturedFrames<1||activeStats.submittedFrames<1)
    throw new Error(`Native capture did not produce frames: ${JSON.stringify(activeStats)}`);
  await command('p2p.addViewer',{
    peerId:'poio-sidecar-smoke-viewer',
    options:{
      iceServers:[],
      minBitrateBps:1_000_000,
      maxBitrateBps:12_000_000,
      maxFrameRate:60,
      maximumPeers:2,
      iceCandidatePoolSize:0,
      degradationPreference:'balanced',
    },
  });
  const offer=await waitForEvent(message=>
    message.event==='p2p.signal'&&
    message.data?.targetPeerId==='poio-sidecar-smoke-viewer'&&
    message.data?.description?.type==='offer',
  );
  if(!offer.data.description.sdp.includes('a=sendonly')||
     !offer.data.description.sdp.includes('H264/90000')||
     !offer.data.description.sdp.toLowerCase().includes('profile-level-id=42e01f'))
    throw new Error('Native P2P offer did not advertise send-only constrained-baseline H.264');
  const p2pStats=await command('stats');
  if(p2pStats.p2pViewers!==1)
    throw new Error(`Native P2P viewer was not retained: ${JSON.stringify(p2pStats)}`);
  await command('p2p.removeViewer',{peerId:'poio-sidecar-smoke-viewer'});
  await command('sfu.setPaused',{paused:true});
  await command('sfu.setPaused',{paused:false});
  await command('stop');
  const stoppedStats=await command('stats');
  if(stoppedStats.running||stoppedStats.producerId)
    throw new Error(`Native session remained active: ${JSON.stringify(stoppedStats)}`);
  if(!requests.includes('sfu.connectTransport')||!requests.includes('sfu.produce'))
    throw new Error(`Missing SFU signaling requests: ${requests.join(', ')}`);
  console.log(JSON.stringify({
    protocol:hello.protocol,
    sourceId:monitor.id,
    producerId:started.producerId,
    requests,
    activeStats,
    p2pOffer:true,
    stopped:true,
  },null,2));
  await command('shutdown');
  child.stdin.end();
  const exitCode=await new Promise(resolve=>child.once('exit',resolve));
  if(exitCode!==0)throw new Error(`Sidecar exited with ${exitCode}: ${stderr}`);
}catch(error){
  child.kill();
  throw error;
}
