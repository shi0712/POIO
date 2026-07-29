import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const serverRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(serverRoot,'../..');
const testRoot=path.join(root,'.tmp-native-share-test');
if(path.dirname(testRoot)!==root||path.basename(testRoot)!=='.tmp-native-share-test')
  throw new Error('Unsafe native-share test directory');
rmSync(testRoot,{recursive:true,force:true});
mkdirSync(testRoot,{recursive:true});
const localMediaAddress='127.0.0.1';
const testMinBitrateBps=Number(process.env.POIO_NATIVE_TEST_MIN_BITRATE??2_000_000);
const testStartBitrateBps=Number(process.env.POIO_NATIVE_TEST_START_BITRATE??8_000_000);
const testMaxBitrateBps=Number(process.env.POIO_NATIVE_TEST_MAX_BITRATE??18_000_000);
const testFrameRate=Number(process.env.POIO_NATIVE_TEST_FPS??60);
if(!Number.isFinite(testFrameRate)||testFrameRate<1||testFrameRate>240)
  throw new Error(`Invalid POIO_NATIVE_TEST_FPS: ${process.env.POIO_NATIVE_TEST_FPS}`);
const minimumThroughputFps=Math.max(1,testFrameRate*.8);

const server=spawn(process.execPath,['dist/index.js'],{
  cwd:serverRoot,
  windowsHide:true,
  stdio:['ignore','pipe','pipe'],
  env:{
    ...process.env,
    HOST:'127.0.0.1',
    PORT:'19920',
    PUBLIC_IP:localMediaAddress,
    DATABASE_PATH:path.join(testRoot,'poio.db'),
    BACKUP_PATH:path.join(testRoot,'backups'),
    UPLOAD_PATH:path.join(testRoot,'uploads'),
    DOWNLOAD_PATH:path.join(root,'deploy/download'),
    RELEASE_PATH:path.join(testRoot,'releases'),
    MEDIASOUP_PORT:'19921',
    MEDIASOUP_MIN_PORT:'49900',
    MEDIASOUP_MAX_PORT:'49920',
  },
});
let serverStderr='';
server.stderr.on('data',chunk=>{serverStderr=`${serverStderr}${chunk}`.slice(-16_384)});

let socket;
let viewerSocket;
let sidecar;
let receiver;
try{
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    try{
      const health=await fetch('http://127.0.0.1:19920/health').then(response=>response.json());
      if(health.ok){ready=true;break}
    }catch{}
    await delay(200);
  }
  if(!ready)throw new Error(`Local POIO server did not start\n${serverStderr}`);

  socket=io('http://127.0.0.1:19920',{
    transports:['websocket'],
    reconnection:false,
  });
  await new Promise((resolve,reject)=>{
    socket.once('connect',resolve);
    socket.once('connect_error',reject);
  });
  const suffix=Date.now().toString(36);
  const auth=await socketRequest(socket,'auth:register',{
    username:`native_${suffix}`,
    password:`Native-${suffix}-secure`,
  });
  const ownerSpace=auth.bootstrap[0];
  const voice=ownerSpace.channels.find(channel=>channel.kind==='voice');
  if(!voice)throw new Error('The local account has no voice channel');
  const invite=await socketRequest(socket,'space:invite',{spaceId:ownerSpace.id});
  viewerSocket=io('http://127.0.0.1:19920',{
    transports:['websocket'],
    reconnection:false,
  });
  await new Promise((resolve,reject)=>{
    viewerSocket.once('connect',resolve);
    viewerSocket.once('connect_error',reject);
  });
  await socketRequest(viewerSocket,'auth:register',{
    username:`viewer_${suffix}`,
    password:`Viewer-${suffix}-secure`,
  });
  await socketRequest(viewerSocket,'space:join',{code:invite.code});
  const capabilities=await socketRequest(socket,'media:capabilities');
  await socketRequest(socket,'media:join',{channelId:voice.id,p2p:true});
  const transport=await socketRequest(socket,'media:createTransport',{direction:'send'});

  receiver=createElectronReceiver();
  sidecar=createSidecar(async message=>{
    if(message.request==='sfu.connectTransport')
      return await socketRequest(socket,'media:connectTransport',message.data);
    if(message.request==='sfu.produce')
      return await socketRequest(socket,'media:produce',message.data);
    throw new Error(`Unexpected sidecar request: ${message.request}`);
  },async message=>{
    if(message.event!=='p2p.signal'||message.data?.targetPeerId!=='electron-receiver')
      return;
    if(message.data.description?.type==='offer'){
      const answer=await receiver.command('offer',{sdp:message.data.description.sdp});
      await sidecar.command('p2p.answer',{
        peerId:'electron-receiver',
        sdp:answer.sdp,
      });
    }
    if(message.data.candidate){
      await receiver.command('candidate',message.data.candidate);
    }
  });
  const sources=await sidecar.command('sources');
  const monitor=sources.find(source=>source.kind==='monitor'&&source.captureSupported);
  if(!monitor)throw new Error('No capturable monitor was reported');
  const [expectedWidth,expectedHeight]=fitOutputDimensions(
    Number(monitor.bounds?.width),
    Number(monitor.bounds?.height),
    Number(process.env.POIO_NATIVE_TEST_MAX_WIDTH??1920),
    Number(process.env.POIO_NATIVE_TEST_MAX_HEIGHT??1080),
  );
  const started=await sidecar.command('start',{
    sourceId:monitor.id,
    captureCursor:false,
    routerRtpCapabilities:capabilities,
    transport,
    publish:{
      minBitrateBps:testMinBitrateBps,
      startBitrateBps:testStartBitrateBps,
      maxBitrateBps:testMaxBitrateBps,
      maxFrameRate:testFrameRate,
      maxWidth:Number(process.env.POIO_NATIVE_TEST_MAX_WIDTH??1920),
      maxHeight:Number(process.env.POIO_NATIVE_TEST_MAX_HEIGHT??1080),
      contentMode:process.env.POIO_NATIVE_TEST_CONTENT_MODE??'motion',
      appData:{mediaTag:'screen',profile:'fps',native:true},
    },
  });

  const active=await waitForStats(sidecar,stats=>{
    const outbound=findReport(stats,'outbound-rtp','video');
    const network=findReport(stats,'transport');
    return stats.running&&
      stats.capturedFrames>30&&
      Number(outbound?.framesEncoded)>10&&
      Number(outbound?.bytesSent)>10_000&&
      network?.dtlsState==='connected';
  },15_000);
  const throughputStartedAt=performance.now();
  await delay(2_000);
  const throughputEndStats=await sidecar.command('stats');
  const throughputEnd=findReport(throughputEndStats,'outbound-rtp','video');
  const activeOutbound=findReport(active,'outbound-rtp','video');
  const encodedFps=
    (Number(throughputEnd?.framesEncoded)-Number(activeOutbound?.framesEncoded))/
    ((performance.now()-throughputStartedAt)/1_000);
  if(encodedFps<minimumThroughputFps)
    throw new Error(`Native hardware encoder throughput is too low (${encodedFps.toFixed(1)} fps)`);

  const viewerDevice=await receiver.command('sfu.load',{
    routerRtpCapabilities:capabilities,
  });
  await socketRequest(viewerSocket,'media:join',{channelId:voice.id,p2p:false});
  const receiveTransport=await socketRequest(
    viewerSocket,
    'media:createTransport',
    {direction:'recv'},
  );
  await receiver.command('sfu.createTransport',receiveTransport);
  const consumerInfo=await socketRequest(viewerSocket,'media:consume',{
    transportId:receiveTransport.id,
    producerId:started.producerId,
    rtpCapabilities:viewerDevice.rtpCapabilities,
  });
  await receiver.command('sfu.consume',consumerInfo);
  let sfuConnecting;
  for(let attempt=0;attempt<100;attempt++){
    const candidate=await receiver.command('sfu.stats');
    if(candidate.error)throw new Error(`Electron SFU receiver failed: ${candidate.error}`);
    if(candidate.pendingDtlsParameters){
      sfuConnecting=candidate;
      break;
    }
    await delay(50);
  }
  if(!sfuConnecting)
    throw new Error(`Electron SFU receiver did not request DTLS: ${JSON.stringify(await receiver.command('sfu.stats'))}`);
  try{
    await socketRequest(viewerSocket,'media:connectTransport',{
      transportId:receiveTransport.id,
      dtlsParameters:sfuConnecting.pendingDtlsParameters,
    });
    await receiver.command('sfu.resolveConnect',{ok:true});
  }catch(error){
    await receiver.command('sfu.resolveConnect',{
      ok:false,
      error:error instanceof Error?error.message:String(error),
    }).catch(()=>{});
    throw error;
  }
  let sfuConsumerReady;
  for(let attempt=0;attempt<100;attempt++){
    const candidate=await receiver.command('sfu.stats');
    if(candidate.error)throw new Error(`Electron SFU receiver failed: ${candidate.error}`);
    if(candidate.consumerId){
      sfuConsumerReady=candidate;
      break;
    }
    await delay(50);
  }
  if(!sfuConsumerReady)
    throw new Error(`Electron SFU consumer was not created: ${JSON.stringify(await receiver.command('sfu.stats'))}`);
  await socketRequest(viewerSocket,'media:resumeConsumer',{consumerId:consumerInfo.id});
  let sfuActive;
  for(let attempt=0;attempt<150;attempt++){
    const candidate=await receiver.command('sfu.stats');
    if(candidate.error)throw new Error(`Electron SFU receiver failed: ${candidate.error}`);
    if(candidate.connectionState==='connected'&&candidate.framesDecoded>30){
      sfuActive=candidate;
      break;
    }
    await delay(100);
  }
  if(!sfuActive)
    throw new Error(`Electron SFU receiver did not decode video: ${JSON.stringify(await receiver.command('sfu.stats'))}`);
  const sfuThroughputStartedAt=performance.now();
  await delay(2_000);
  const sfuFinal=await receiver.command('sfu.stats');
  const sfuThroughputSeconds=Math.max(
    .001,
    (performance.now()-sfuThroughputStartedAt)/1_000,
  );
  const sfuDecodedFps=
    (sfuFinal.framesDecoded-sfuActive.framesDecoded)/sfuThroughputSeconds;
  if(sfuFinal.width!==expectedWidth||sfuFinal.height!==expectedHeight)
    throw new Error(`Electron SFU receiver resolution is ${sfuFinal.width}x${sfuFinal.height}`);
  if(sfuDecodedFps<minimumThroughputFps)
    throw new Error(`Electron SFU decode throughput is too low (${sfuDecodedFps.toFixed(1)} fps)`);
  if(sfuFinal.framesDropped-sfuActive.framesDropped>5)
    throw new Error(`Electron SFU receiver dropped too many frames (${sfuFinal.framesDropped-sfuActive.framesDropped})`);
  if(sfuFinal.packetsLost>0)
    throw new Error(`Electron SFU receiver lost packets (${sfuFinal.packetsLost})`);
  await receiver.command('sfu.close');
  await Promise.all([
    socketRequest(viewerSocket,'media:closeConsumer',{consumerId:consumerInfo.id}).catch(()=>{}),
    socketRequest(viewerSocket,'media:closeTransport',{transportId:receiveTransport.id}).catch(()=>{}),
  ]);

  const beforePauseStats=await sidecar.command('stats');
  const beforePause=findReport(beforePauseStats,'outbound-rtp','video');
  await sidecar.command('sfu.setPaused',{paused:true});
  await delay(1_000);
  const paused=await sidecar.command('stats');
  const pausedOutbound=findReport(paused,'outbound-rtp','video');
  const pauseGrowth=Number(pausedOutbound?.framesEncoded)-Number(beforePause?.framesEncoded);
  if(pauseGrowth>3)
    throw new Error(`SFU encoder kept running while paused (${pauseGrowth} frames)`);

  await sidecar.command('sfu.setPaused',{paused:false});
  const resumed=await waitForStats(sidecar,stats=>
    Number(findReport(stats,'outbound-rtp','video')?.framesEncoded)>
      Number(pausedOutbound?.framesEncoded)+5,
  10_000);
  await sidecar.command('p2p.addViewer',{
    peerId:'electron-receiver',
    options:{
      minBitrateBps:testMinBitrateBps,
      startBitrateBps:testStartBitrateBps,
      maxBitrateBps:testMaxBitrateBps,
      maxFrameRate:testFrameRate,
      maximumPeers:2,
      iceCandidatePoolSize:2,
      degradationPreference:'preserve-resolution',
    },
  });
  const p2pStartedAt=performance.now();
  let p2pActive;
  for(let attempt=0;attempt<100;attempt++){
    const candidate=await receiver.command('stats');
    if(candidate.connectionState==='connected'&&candidate.framesDecoded>30){
      p2pActive=candidate;
      break;
    }
    await delay(100);
  }
  if(!p2pActive)
    throw new Error(`Electron P2P receiver did not decode video: ${JSON.stringify(await receiver.command('stats'))}`);
  const p2pThroughputStartedAt=performance.now();
  await delay(2_000);
  const p2pFinal=await receiver.command('stats');
  const p2pSeconds=Math.max(.001,(performance.now()-p2pStartedAt)/1_000);
  const p2pThroughputSeconds=Math.max(
    .001,
    (performance.now()-p2pThroughputStartedAt)/1_000,
  );
  const decodedFps=
    (p2pFinal.framesDecoded-p2pActive.framesDecoded)/p2pThroughputSeconds;
  if(p2pFinal.width!==expectedWidth||p2pFinal.height!==expectedHeight)
    throw new Error(`Electron P2P receiver resolution is ${p2pFinal.width}x${p2pFinal.height}`);
  if(decodedFps<minimumThroughputFps)
    throw new Error(`Electron P2P decode throughput is too low (${decodedFps.toFixed(1)} fps)`);
  if(p2pFinal.framesDropped-p2pActive.framesDropped>5)
    throw new Error(`Electron P2P receiver dropped too many frames (${p2pFinal.framesDropped-p2pActive.framesDropped})`);
  await sidecar.command('p2p.removeViewer',{peerId:'electron-receiver'});
  await receiver.command('close');
  const outbound=findReport(resumed,'outbound-rtp','video');
  const mediaSource=findReport(resumed,'media-source','video');
  const network=findReport(resumed,'transport');
  await sidecar.command('stop');
  const stopped=await sidecar.command('stats');
  if(stopped.running||stopped.producerId)
    throw new Error(`Native session remained active: ${JSON.stringify(stopped)}`);
  await sidecar.shutdown();
  sidecar=undefined;

  console.log(JSON.stringify({
    nativeSfu:true,
    contentMode:process.env.POIO_NATIVE_TEST_CONTENT_MODE??'motion',
    requestedFrameRate:testFrameRate,
    mediaAddress:localMediaAddress,
    sourceId:monitor.id,
    producerId:started.producerId,
    width:resumed.width,
    height:resumed.height,
    capturedFrames:resumed.capturedFrames,
    submittedFrames:resumed.submittedFrames,
    pacedFrames:resumed.pacedFrames,
    rejectedFrames:resumed.rejectedFrames,
    encodedFrames:Number(outbound?.framesEncoded),
    encodedFps:Number(encodedFps.toFixed(1)),
    framesPerSecond:Number(mediaSource?.framesPerSecond),
    bytesSent:Number(outbound?.bytesSent),
    codecId:outbound?.codecId,
    encoderImplementation:outbound?.encoderImplementation,
    powerEfficientEncoder:outbound?.powerEfficientEncoder,
    dtlsState:network?.dtlsState,
    iceState:network?.iceState,
    pausedFrameGrowth:pauseGrowth,
    resumed:true,
    sfu:{
      width:sfuFinal.width,
      height:sfuFinal.height,
      decodedFps:Number(sfuDecodedFps.toFixed(1)),
      framesDecoded:sfuFinal.framesDecoded,
      framesDropped:sfuFinal.framesDropped,
      packetsLost:sfuFinal.packetsLost,
      bytesReceived:sfuFinal.bytesReceived,
      codec:sfuFinal.codec,
      decoderImplementation:sfuFinal.decoderImplementation,
      powerEfficientDecoder:sfuFinal.powerEfficientDecoder,
    },
    p2p:{
      width:p2pFinal.width,
      height:p2pFinal.height,
      decodedFps:Number(decodedFps.toFixed(1)),
      framesDecoded:p2pFinal.framesDecoded,
      framesDropped:p2pFinal.framesDropped,
      packetsLost:p2pFinal.packetsLost,
      maxRenderGapMs:Number(p2pFinal.maxRenderGapMs.toFixed(1)),
      codec:p2pFinal.codec,
      decoderImplementation:p2pFinal.decoderImplementation,
      powerEfficientDecoder:p2pFinal.powerEfficientDecoder,
      measuredSeconds:Number(p2pSeconds.toFixed(2)),
    },
    stopped:true,
  },null,2));
}finally{
  socket?.close();
  viewerSocket?.close();
  if(receiver)await receiver.shutdown().catch(()=>{});
  if(sidecar)await sidecar.shutdown().catch(()=>{});
  if(server.exitCode===null){
    server.kill();
    await new Promise(resolve=>server.once('exit',resolve));
  }
  rmSync(testRoot,{recursive:true,force:true});
}

function delay(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function fitOutputDimensions(width,height,maxWidth,maxHeight){
  if(!width||!height)throw new Error('Capture source dimensions are unavailable');
  if((!maxWidth&&!maxHeight)||
    ((!maxWidth||width<=maxWidth)&&(!maxHeight||height<=maxHeight)))
    return [width,height];
  const scale=Math.min(
    1,
    maxWidth?maxWidth/width:1,
    maxHeight?maxHeight/height:1,
  );
  return [
    Math.max(2,Math.floor(width*scale)&~1),
    Math.max(2,Math.floor(height*scale)&~1),
  ];
}

function socketRequest(target,event,payload={}){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`${event} timed out`)),15_000);
    target.emit(event,payload,reply=>{
      clearTimeout(timer);
      if(reply?.ok)resolve(reply.value);
      else reject(new Error(reply?.error??`${event} failed`));
    });
  });
}

function findReport(stats,type,kind){
  return (Array.isArray(stats.sfuStats)?stats.sfuStats:[]).find(report=>
    report.type===type&&(!kind||report.kind===kind||report.mediaType===kind),
  );
}

async function waitForStats(target,predicate,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  let last;
  while(Date.now()<deadline){
    last=await target.command('stats');
    if(predicate(last))return last;
    await delay(250);
  }
  throw new Error(`Native SFU stats condition timed out: ${JSON.stringify(last)}`);
}

function createSidecar(onRequest,onEvent=()=>{}){
  const executable=path.join(
    root,
    'native',
    'share-core',
    'build-mediasoup',
    'poio-share-sidecar.exe',
  );
  const child=spawn(executable,[],{
    cwd:path.dirname(executable),
    windowsHide:true,
    stdio:['pipe','pipe','pipe'],
  });
  let nextId=1;
  let stderr='';
  const pending=new Map();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{
    stderr=`${stderr}${chunk}`.slice(-32_768);
    if(process.env.POIO_SHARE_DEBUG)process.stderr.write(chunk);
  });
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
      void onRequest(message).then(
        result=>child.stdin.write(`${JSON.stringify({
          method:'resolve',
          params:{requestId:message.requestId,ok:true,result},
        })}\n`),
        error=>child.stdin.write(`${JSON.stringify({
          method:'resolve',
          params:{
            requestId:message.requestId,
            ok:false,
            error:error instanceof Error?error.message:String(error),
          },
        })}\n`),
      );
      return;
    }
    if(message.type==='event')void Promise.resolve(onEvent(message)).catch(error=>{
      process.stderr.write(`Native sidecar event failed: ${error instanceof Error?error.stack:error}\n`);
    });
  });
  const command=(method,params={})=>{
    const id=String(nextId++);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        pending.delete(id);
        reject(new Error(`${method} timed out; ${stderr}`));
      },30_000);
      pending.set(id,{resolve,reject,timer});
      child.stdin.write(`${JSON.stringify({id,method,params})}\n`);
    });
  };
  return {
    command,
    stderr:()=>stderr,
    async shutdown(){
      if(child.exitCode!==null)return;
      await command('shutdown').catch(()=>{});
      child.stdin.end();
      const timer=setTimeout(()=>child.kill(),2_000);
      await new Promise(resolve=>child.once('exit',resolve));
      clearTimeout(timer);
    },
  };
}

function createElectronReceiver(){
  const executable=path.join(root,'node_modules','electron','dist','electron.exe');
  const script=path.join(serverRoot,'scripts','electron-webrtc-receiver.cjs');
  const child=spawn(executable,[script],{
    cwd:serverRoot,
    windowsHide:true,
    stdio:['ignore','pipe','pipe','ipc'],
  });
  let nextId=1;
  let stderr='';
  let readyResolve;
  let readyReject;
  const ready=new Promise((resolve,reject)=>{
    readyResolve=resolve;
    readyReject=reject;
  });
  const pending=new Map();
  const readyTimer=setTimeout(
    ()=>readyReject(new Error(`Electron receiver startup timed out: ${stderr}`)),
    15_000,
  );
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr=`${stderr}${chunk}`.slice(-16_384)});
  child.on('message',message=>{
    if(message?.type==='ready'){
      clearTimeout(readyTimer);
      readyResolve();
      return;
    }
    if(message?.type==='startup-error'){
      clearTimeout(readyTimer);
      readyReject(new Error(message.error));
      return;
    }
    const waiter=pending.get(String(message?.id));
    if(!waiter)return;
    pending.delete(String(message.id));
    clearTimeout(waiter.timer);
    if(message.ok)waiter.resolve(message.result);
    else waiter.reject(new Error(message.error||'Electron receiver command failed'));
  });
  child.once('exit',(code,signal)=>{
    const error=new Error(
      `Electron receiver exited (${code??'unknown'}${signal?`, ${signal}`:''}): ${stderr}`,
    );
    clearTimeout(readyTimer);
    readyReject(error);
    for(const waiter of pending.values()){
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  });
  return {
    async command(method,params={}){
      await ready;
      const id=String(nextId++);
      return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{
          pending.delete(id);
          reject(new Error(`Electron receiver ${method} timed out: ${stderr}`));
        },20_000);
        pending.set(id,{resolve,reject,timer});
        child.send({id,method,params},error=>{
          if(!error)return;
          const waiter=pending.get(id);
          if(!waiter)return;
          pending.delete(id);
          clearTimeout(waiter.timer);
          waiter.reject(error);
        });
      });
    },
    async shutdown(){
      if(child.exitCode!==null)return;
      await this.command('close').catch(()=>{});
      child.kill();
      await new Promise(resolve=>child.once('exit',resolve));
    },
  };
}
