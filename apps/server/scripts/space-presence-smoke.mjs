import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const connect=()=>new Promise((resolve,reject)=>{const socket=io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});socket.once('connect',()=>resolve(socket));socket.once('connect_error',reject)});
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
const waitFor=(socket,event,predicate,timeoutMs=15000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,listener);reject(new Error(`${event} timeout`))},timeoutMs);const listener=value=>{if(!predicate(value))return;clearTimeout(timer);socket.off(event,listener);resolve(value)};socket.on(event,listener)});

const owner=await connect();const guest=await connect();let resumed;
try{
  const suffix=Date.now().toString(36);const ownerAuth=await request(owner,'auth:register',{username:`pown_${suffix}`,password:`Owner-${suffix}-secure`});const guestAuth=await request(guest,'auth:register',{username:`pgst_${suffix}`,password:`Guest-${suffix}-secure`});const space=ownerAuth.bootstrap[0];const invite=await request(owner,'space:invite',{spaceId:space.id});
  const joinedEvent=waitFor(owner,'space:presence',value=>value?.spaceId===space.id&&value.userIds?.includes(guestAuth.user.id));
  await request(guest,'space:join',{code:invite.code});await joinedEvent;
  const online=await request(owner,'space:presence',{spaceId:space.id});
  if(!online.includes(ownerAuth.user.id)||!online.includes(guestAuth.user.id))throw new Error(`presence join mismatch: ${JSON.stringify(online)}`);
  const offlineEvent=waitFor(owner,'space:presence',value=>value?.spaceId===space.id&&!value.userIds?.includes(guestAuth.user.id));guest.disconnect();await offlineEvent;
  resumed=await connect();const onlineAgainEvent=waitFor(owner,'space:presence',value=>value?.spaceId===space.id&&value.userIds?.includes(guestAuth.user.id));await request(resumed,'auth:resume',{token:guestAuth.token});await onlineAgainEvent;
  console.log(JSON.stringify({spacePresence:true,joinOnline:true,disconnectOffline:true,resumeOnline:true,onlineUsers:2}));
}finally{owner.disconnect();guest.disconnect();resumed?.disconnect()}
