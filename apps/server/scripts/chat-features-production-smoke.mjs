import { io } from 'socket.io-client';

const origin=process.env.POIO_SMOKE_URL??'https://115.159.222.29';
const sockets=[];

const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15_000);
  socket.emit(event,payload,reply=>{
    clearTimeout(timer);
    reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`));
  });
});
const eventOnce=(socket,event,predicate=()=>true)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
    socket.off(event,listener);
    reject(new Error(`${event} event timeout`));
  },10_000);
  const listener=value=>{
    if(!predicate(value))return;
    clearTimeout(timer);
    socket.off(event,listener);
    resolve(value);
  };
  socket.on(event,listener);
});
const connect=async()=>{
  const socket=io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{
    socket.once('connect',resolve);
    socket.once('connect_error',reject);
  });
  sockets.push(socket);
  return socket;
};

try{
  const [ownerSocket,guestSocket]=await Promise.all([connect(),connect()]);
  const suffix=Date.now().toString(36);
  const owner=await request(ownerSocket,'auth:register',{username:`chat_owner_${suffix}`,password:`Owner-${suffix}-secure`});
  const guest=await request(guestSocket,'auth:register',{username:`chat_guest_${suffix}`,password:`Guest-${suffix}-secure`});
  const capabilities=await request(ownerSocket,'app:capabilities');
  const required=['chatReplies','chatEditing','chatReactions','chatSearch','chatMentions'];
  for(const feature of required){
    if(!capabilities.features?.[feature])throw new Error(`missing capability: ${feature}`);
  }

  const space=owner.bootstrap[0];
  const channel=space.channels.find(item=>item.kind==='text');
  if(!channel)throw new Error('default text channel missing');
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
    body:`Production chat smoke @${guest.user.username}`,
  });
  const [mentioned,observedRoot]=await Promise.all([mentionEvent,rootEvent]);
  if(mentioned.message.id!==root.id||observedRoot.id!==root.id)throw new Error('mention or realtime send mismatch');

  const replyEvent=eventOnce(ownerSocket,'chat:message',value=>value.reply?.id===root.id);
  const reply=await request(guestSocket,'chat:send',{channelId:channel.id,body:'reply received',replyToId:root.id});
  const observedReply=await replyEvent;
  if(reply.reply?.id!==root.id||observedReply.id!==reply.id)throw new Error('reply mismatch');

  const editEvent=eventOnce(ownerSocket,'chat:messageUpdated',value=>value.id===reply.id&&value.body==='reply edited');
  const edited=await request(guestSocket,'chat:edit',{messageId:reply.id,body:'reply edited'});
  await editEvent;
  if(!edited.editedAt)throw new Error('edited timestamp missing');

  const reactionEvent=eventOnce(guestSocket,'chat:messageUpdated',value=>value.id===reply.id&&value.reactions?.length===1);
  const reacted=await request(ownerSocket,'chat:react',{messageId:reply.id,emoji:'\u{1F44D}'});
  await reactionEvent;
  if(reacted.reactions[0]?.count!==1||!reacted.reactions[0].userIds.includes(owner.user.id))throw new Error('reaction mismatch');

  const search=await request(ownerSocket,'chat:search',{channelId:channel.id,query:'reply edited'});
  if(search.length!==1||search[0].id!==reply.id)throw new Error(`search mismatch: ${JSON.stringify(search)}`);

  const deleteEvent=eventOnce(ownerSocket,'chat:messageUpdated',value=>value.id===reply.id&&value.deleted===true);
  const deleted=await request(guestSocket,'chat:delete',{messageId:reply.id});
  await deleteEvent;
  if(!deleted.deleted||deleted.body||deleted.reactions.length)throw new Error('delete tombstone mismatch');

  const history=await request(ownerSocket,'chat:history',{channelId:channel.id});
  if(!history.find(item=>item.id===reply.id)?.deleted)throw new Error('deleted message missing from history');

  console.log(JSON.stringify({
    production:true,
    serverVersion:capabilities.serverVersion,
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
}
