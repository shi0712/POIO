import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const runtime=mkdtempSync(path.join(os.tmpdir(),'poio-chat-features-'));
const port=19400+Math.floor(Math.random()*300);
const mediaPort=port+1000;
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['apps/server/dist/index.js'],{
  cwd:path.resolve('.'),
  windowsHide:true,
  stdio:['ignore','pipe','pipe'],
  env:{
    ...process.env,
    HOST:'127.0.0.1',
    PORT:String(port),
    PUBLIC_IP:'127.0.0.1',
    MEDIASOUP_PORT:String(mediaPort),
    MEDIASOUP_MIN_PORT:String(mediaPort+1),
    MEDIASOUP_MAX_PORT:String(mediaPort+50),
    DATABASE_PATH:path.join(runtime,'poio.db'),
    BACKUP_PATH:path.join(runtime,'backups'),
    UPLOAD_PATH:path.join(runtime,'uploads'),
  },
});
let output='';
child.stdout.on('data',chunk=>output+=chunk);
child.stderr.on('data',chunk=>output+=chunk);
const sockets=[];

const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),8_000);
  socket.emit(event,payload,reply=>{
    clearTimeout(timer);
    reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`));
  });
});
const eventOnce=(socket,event,predicate=()=>true)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(event,listener);reject(new Error(`${event} event timeout`))},5_000);
  const listener=value=>{
    if(!predicate(value))return;
    clearTimeout(timer);
    socket.off(event,listener);
    resolve(value);
  };
  socket.on(event,listener);
});
const connect=async()=>{
  const socket=io(origin,{path:'/socket.io',transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
  sockets.push(socket);
  return socket;
};

try{
  const deadline=Date.now()+15_000;
  let ready=false;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}: ${output}`);
    try{
      const health=await fetch(`${origin}/health`).then(response=>response.json());
      if(health.ok){ready=true;break}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,180));
  }
  if(!ready)throw new Error(`server did not start: ${output}`);

  const [ownerSocket,guestSocket]=await Promise.all([connect(),connect()]);
  const suffix=Date.now().toString(36);
  const owner=await request(ownerSocket,'auth:register',{username:`chat_owner_${suffix}`,password:`Owner-${suffix}-secure`});
  const guest=await request(guestSocket,'auth:register',{username:`chat_guest_${suffix}`,password:`Guest-${suffix}-secure`});
  const space=owner.bootstrap[0];
  const channel=space.channels.find(item=>item.kind==='text');
  const invite=await request(ownerSocket,'space:invite',{spaceId:space.id});
  await request(guestSocket,'space:join',{code:invite.code});
  await Promise.all([
    request(ownerSocket,'channel:watch',{channelId:channel.id}),
    request(guestSocket,'channel:watch',{channelId:channel.id}),
  ]);

  const mentionEvent=eventOnce(guestSocket,'chat:mention',value=>value.channelId===channel.id);
  const rootEvent=eventOnce(guestSocket,'chat:message',value=>value.channelId===channel.id);
  const root=await request(ownerSocket,'chat:send',{
    channelId:channel.id,
    body:`欢迎 @${guest.user.username}`,
  });
  const [mentioned,observedRoot]=await Promise.all([mentionEvent,rootEvent]);
  if(mentioned.message.id!==root.id||observedRoot.id!==root.id)throw new Error('mention or realtime send mismatch');

  const replyEvent=eventOnce(ownerSocket,'chat:message',value=>value.reply?.id===root.id);
  const reply=await request(guestSocket,'chat:send',{channelId:channel.id,body:'收到',replyToId:root.id});
  const observedReply=await replyEvent;
  if(reply.reply?.id!==root.id||observedReply.id!==reply.id)throw new Error('reply mismatch');

  const editEvent=eventOnce(ownerSocket,'chat:messageUpdated',value=>value.id===reply.id&&value.body==='已经收到');
  const edited=await request(guestSocket,'chat:edit',{messageId:reply.id,body:'已经收到'});
  await editEvent;
  if(!edited.editedAt)throw new Error('edited timestamp missing');

  const reactionEvent=eventOnce(guestSocket,'chat:messageUpdated',value=>value.id===reply.id&&value.reactions?.length===1);
  const reacted=await request(ownerSocket,'chat:react',{messageId:reply.id,emoji:'👍'});
  await reactionEvent;
  if(reacted.reactions[0]?.count!==1||!reacted.reactions[0].userIds.includes(owner.user.id))throw new Error('reaction mismatch');

  const search=await request(ownerSocket,'chat:search',{channelId:channel.id,query:'已经'});
  if(search.length!==1||search[0].id!==reply.id)throw new Error(`search mismatch: ${JSON.stringify(search)}`);

  const deleteEvent=eventOnce(ownerSocket,'chat:messageUpdated',value=>value.id===reply.id&&value.deleted===true);
  const deleted=await request(guestSocket,'chat:delete',{messageId:reply.id});
  await deleteEvent;
  if(!deleted.deleted||deleted.body||deleted.reactions.length)throw new Error('delete tombstone mismatch');

  const history=await request(ownerSocket,'chat:history',{channelId:channel.id});
  const stored=history.find(item=>item.id===reply.id);
  const capabilities=await request(ownerSocket,'app:capabilities');
  if(!stored?.deleted||!capabilities.features.chatReplies||!capabilities.features.chatSearch)
    throw new Error('history or advertised capabilities mismatch');

  console.log(JSON.stringify({
    chatFeatures:true,
    realtime:true,
    replies:true,
    editing:true,
    reactions:true,
    mentions:true,
    search:true,
    deletion:true,
  }));
}finally{
  for(const socket of sockets)socket.close();
  child.kill();
  await new Promise(resolve=>setTimeout(resolve,350));
  rmSync(runtime,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
