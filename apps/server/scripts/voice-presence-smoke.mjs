import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const createSocket=()=>io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});
const connected=socket=>new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
const nextPresence=(socket,channelId)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('voice:presence timeout')),5000);const listener=event=>{if(event.channelId!==channelId)return;clearTimeout(timer);socket.off('voice:presence',listener);resolve(event)};socket.on('voice:presence',listener)});

const first=createSocket();const second=createSocket();
try{
  await Promise.all([connected(first),connected(second)]);
  const suffix=Date.now().toString(36);const auth=await request(first,'auth:register',{username:`presence_${suffix}`,password:`Test-${suffix}-secure`});
  await request(second,'auth:resume',{token:auth.token});
  const channel=auth.bootstrap[0].channels.find(item=>item.kind==='voice');
  const firstEvent=nextPresence(first,channel.id);const firstJoin=await request(first,'voice:join',{channelId:channel.id});await firstEvent;
  const secondEvent=nextPresence(first,channel.id);const secondJoin=await request(second,'voice:join',{channelId:channel.id});const joined=await secondEvent;
  const leaveEvent=nextPresence(first,channel.id);await request(second,'voice:leave');const remaining=await leaveEvent;
  const emptyEvent=nextPresence(first,channel.id);await request(first,'voice:leave');const empty=await emptyEvent;
  if(firstJoin.users.length!==1||secondJoin.users.length!==1||joined.users.length!==1||remaining.users.length!==1||empty.users.length!==0)throw new Error('voice presence state mismatch');
  console.log(JSON.stringify({voicePresence:true,channelId:channel.id,joinedUsers:joined.users.length,remainingUsers:remaining.users.length,afterLeave:empty.users.length}));
}finally{first.close();second.close()}
