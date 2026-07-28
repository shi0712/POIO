import { io } from 'socket.io-client';

const origin=process.env.POIO_SMOKE_URL??'http://127.0.0.1:18920';
const path=process.env.POIO_SOCKET_PATH??'/socket.io';
const sockets=[];

const connect=async()=>{
  const socket=io(origin,{path,transports:['websocket'],reconnection:false});
  sockets.push(socket);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
  return socket;
};
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),5000);
  socket.emit(event,payload,reply=>{
    clearTimeout(timer);
    reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`));
  });
});
const event=(socket,name,predicate=()=>true)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(name,listener);reject(new Error(`${name} timeout`))},5000);
  const listener=value=>{if(!predicate(value))return;clearTimeout(timer);socket.off(name,listener);resolve(value)};
  socket.on(name,listener);
});

try {
  const suffix=Date.now().toString(36);
  const owner=await connect();
  const ownerAuth=await request(owner,'auth:register',{username:`p2p_o_${suffix}`,password:`P2P-${suffix}-secure`});
  const space=ownerAuth.bootstrap[0];
  const voice=space.channels.find(channel=>channel.kind==='voice');
  const invite=await request(owner,'space:invite',{spaceId:space.id});
  const viewers=[];
  for(const label of ['a','b','c']) {
    const socket=await connect();
    await request(socket,'auth:register',{username:`p2p_${label}_${suffix}`,password:`P2P-${suffix}-secure`});
    await request(socket,'space:join',{code:invite.code});
    viewers.push(socket);
  }
  const ownerJoin=await request(owner,'media:join',{channelId:voice.id,p2p:true});
  if(ownerJoin.p2pEnabled!==true||!Array.isArray(ownerJoin.iceServers)||!ownerJoin.iceServers.length)throw new Error('P2P/ICE configuration missing');
  for(const viewer of viewers)await request(viewer,'media:join',{channelId:voice.id,p2p:true});

  const starts=viewers.map(viewer=>event(viewer,'media:p2p:shareStarted'));
  await request(owner,'media:p2p:announce',{profile:'fps',hasAudio:true});
  const announcements=await Promise.all(starts);
  if(announcements.some(value=>value.profile!=='fps'||!value.hasAudio))throw new Error('share announcement mismatch');

  const watchA=event(owner,'media:p2p:watchRequested');
  const watchB=event(owner,'media:p2p:watchRequested');
  await request(viewers[0],'media:p2p:watch',{sharerSocketId:owner.id});
  await request(viewers[1],'media:p2p:watch',{sharerSocketId:owner.id});
  await Promise.all([watchA,watchB]);
  let capped=false;
  try { await request(viewers[2],'media:p2p:watch',{sharerSocketId:owner.id}); }
  catch(error) { capped=String(error.message).includes('直连观看人数已满'); }
  if(!capped)throw new Error('third P2P viewer was not capped');

  const offerEvent=event(viewers[0],'media:p2p:signal',value=>value.fromSocketId===owner.id);
  await request(owner,'media:p2p:signal',{targetSocketId:viewers[0].id,description:{type:'offer',sdp:'v=0\r\n'}});
  const offer=await offerEvent;
  if(offer.description?.type!=='offer')throw new Error('offer was not routed');

  await request(viewers[0],'media:p2p:disconnect',{peerSocketId:owner.id});
  const replacement=event(owner,'media:p2p:watchRequested',value=>value.viewerSocketId===viewers[2].id);
  await request(viewers[2],'media:p2p:watch',{sharerSocketId:owner.id});
  await replacement;

  const stopped=viewers.map(viewer=>event(viewer,'media:p2p:shareStopped'));
  await request(owner,'media:p2p:stop');
  await Promise.all(stopped);
  console.log(JSON.stringify({p2pSignaling:true,maxDirectViewers:2,iceServers:ownerJoin.iceServers.length,offerRouted:true,replacementViewer:true}));
} finally {
  for(const socket of sockets)socket.close();
}
