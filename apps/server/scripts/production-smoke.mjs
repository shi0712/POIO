import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const socket=io(origin,{path:'/echodeck/socket.io',transports:['websocket'],reconnection:false});
const request=(event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,(reply)=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
try {
  const suffix=Date.now().toString(36);const auth=await request('auth:register',{username:`smoke_${suffix}`,password:`Test-${suffix}-secure`});
  const voice=auth.bootstrap[0].channels.find(channel=>channel.kind==='voice');
  const text=auth.bootstrap[0].channels.find(channel=>channel.kind==='text');
  if(!voice)throw new Error('default voice channel missing');
  if(!text)throw new Error('default text channel missing');
  const unicodeName='测试图片-聊天截图.png';
  const form=new FormData();
  form.append('file',new File([new Uint8Array([137,80,78,71])],unicodeName,{type:'image/png'}));
  const uploadResponse=await fetch(`${origin}/echodeck/api/uploads`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`},body:form});
  const uploaded=await uploadResponse.json();
  if(!uploadResponse.ok||uploaded.name!==unicodeName)throw new Error(`unicode upload filename mismatch: ${JSON.stringify(uploaded)}`);
  await request('chat:send',{channelId:text.id,body:'',attachment:uploaded});
  const history=await request('chat:history',{channelId:text.id});
  if(history.at(-1)?.attachmentName!==unicodeName)throw new Error(`unicode history filename mismatch: ${JSON.stringify(history.at(-1))}`);
  const avatarForm=new FormData();avatarForm.append('file',new File([new Uint8Array([71,73,70,56,57,97])],'动态头像.gif',{type:'image/gif'}));
  const avatarResponse=await fetch(`${origin}/echodeck/api/uploads`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`},body:avatarForm});const avatarUpload=await avatarResponse.json();
  const updatedUser=await request('user:avatar',{url:avatarUpload.url});const members=await request('space:members',{spaceId:auth.bootstrap[0].id});
  if(!avatarResponse.ok||!updatedUser.avatarUrl?.endsWith('.gif')||members.find(item=>item.id===auth.user.id)?.avatarUrl!==updatedUser.avatarUrl)throw new Error(`animated avatar mismatch: ${JSON.stringify({avatarUpload,updatedUser,members})}`);
  const credentials=await request('voice:credentials',{channelId:voice.id});
  const created=await request('channel:create',{spaceId:auth.bootstrap[0].id,name:'联调语音',kind:'voice'});
  const createdCredentials=await request('voice:credentials',{channelId:created.id});
  const message=await request('chat:send',{channelId:voice.id,body:'EchoDeck production smoke test'});
  if(message.avatarUrl!==updatedUser.avatarUrl)throw new Error(`message avatar mismatch: ${JSON.stringify(message)}`);
  const capabilities=await request('media:capabilities');await request('media:join',{channelId:voice.id});const transport=await request('media:createTransport',{direction:'send'});
  console.log(JSON.stringify({connected:true,user:auth.user.username,unicodeUploadName:uploaded.name,unicodeHistoryName:history.at(-1)?.attachmentName,animatedAvatar:updatedUser.avatarUrl,messageAvatar:message.avatarUrl,defaultVoice:voice.id,voiceHost:credentials.host,voicePort:credentials.port,voiceChannel:credentials.channelName,createdVoice:createdCredentials.channelName,messageId:message.id,screenCodecs:capabilities.codecs.map(codec=>codec.mimeType),screenTransport:Boolean(transport.id)}));
} finally {socket.close();}
