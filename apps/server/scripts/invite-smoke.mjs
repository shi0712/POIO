import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const connect=()=>new Promise((resolve,reject)=>{
  const socket=io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});
  socket.once('connect',()=>resolve(socket));socket.once('connect_error',reject);
});
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);
  socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))});
});

const suffix=Date.now().toString(36);
const owner=await connect();const guest=await connect();
try{
  const ownerAuth=await request(owner,'auth:register',{username:`owner_${suffix}`,password:`Owner-${suffix}-secure`});
  const guestName=`guest_${suffix}`;const guestPassword=`Guest-${suffix}-secure`;const guestAuth=await request(guest,'auth:register',{username:guestName,password:guestPassword});
  const sourceSpace=ownerAuth.bootstrap[0];
  const invite=await request(owner,'space:invite',{spaceId:sourceSpace.id});
  const joined=await request(guest,'space:join',{code:invite.code});
  const guestSpaces=await request(guest,'bootstrap');
  const members=await request(guest,'space:members',{spaceId:sourceSpace.id});
  const relogged=await request(guest,'auth:login',{username:guestName,password:guestPassword});
  if(joined.id!==sourceSpace.id||!guestSpaces.some(space=>space.id===sourceSpace.id))throw new Error('joined community missing from bootstrap');
  if(!members.some(member=>member.id===ownerAuth.user.id&&member.role==='owner')||!members.some(member=>member.id===guestAuth.user.id&&member.role==='member'))throw new Error('community member list is incomplete');
  if(!joined.channels.some(channel=>channel.kind==='text')||!joined.channels.some(channel=>channel.kind==='voice'))throw new Error('joined community channels are incomplete');
  if(!relogged.bootstrap.some(space=>space.id===sourceSpace.id))throw new Error('joined community was lost after login');
  console.log(JSON.stringify({inviteJoin:true,persistentAfterLogin:true,codeLength:invite.code.length,spaceId:joined.id,channels:joined.channels.length,members:members.length}));
}finally{owner.close();guest.close()}
