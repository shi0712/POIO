import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { io } from 'socket.io-client';

const runtime=mkdtempSync(path.join(os.tmpdir(),'poio-local-smoke-'));
const databasePath=path.join(runtime,'echodeck.db');
const port=18920+Math.floor(Math.random()*500);
const mediaPort=port+1000;
const child=spawn(process.execPath,['apps/server/dist/index.js'],{cwd:path.resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_IP:'127.0.0.1',MEDIASOUP_PORT:String(mediaPort),MEDIASOUP_MIN_PORT:String(mediaPort+1),MEDIASOUP_MAX_PORT:String(mediaPort+50),DATABASE_PATH:databasePath,BACKUP_PATH:path.join(runtime,'backups'),UPLOAD_PATH:path.join(runtime,'uploads')}});
let serverOutput='';child.stdout.on('data',chunk=>serverOutput+=chunk);child.stderr.on('data',chunk=>serverOutput+=chunk);
const origin=`http://127.0.0.1:${port}`;
const connect=async()=>{const socket=io(origin,{path:'/socket.io',transports:['websocket'],reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});return socket};
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),8000);socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
const once=(socket,event)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,listener);reject(new Error(`${event} event timeout`))},4000);const listener=value=>{clearTimeout(timer);socket.off(event,listener);resolve(value)};socket.on(event,listener)});
const presence=(socket,channelId)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off('voice:presence',listener);reject(new Error('voice:presence timeout'))},4000);const listener=value=>{if(value?.channelId!==channelId)return;clearTimeout(timer);socket.off('voice:presence',listener);resolve(value)};socket.on('voice:presence',listener)});
const sockets=[];
try{
  const deadline=Date.now()+15000;let ready=false;
  while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`local server exited ${child.exitCode}: ${serverOutput}`);try{const value=await fetch(`${origin}/health`).then(response=>response.json());if(value.ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
  if(!ready)throw new Error(`local server did not start: ${serverOutput}`);
  const [first,second,outsider]=await Promise.all([connect(),connect(),connect()]);sockets.push(first,second,outsider);
  const suffix=Date.now().toString(36);
  const auth=await request(first,'auth:register',{username:`local_${suffix}`,password:`Test-${suffix}-secure`});
  await request(second,'auth:resume',{token:auth.token});
  await request(outsider,'auth:register',{username:`outside_${suffix}`,password:`Test-${suffix}-secure`});
  const unicodeName='测试图片-聊天截图.png';const form=new FormData();form.append('file',new File([new Uint8Array([137,80,78,71])],unicodeName,{type:'image/png'}));
  const uploadResponse=await fetch(`${origin}/api/uploads`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`},body:form});const uploaded=await uploadResponse.json();
  if(!uploadResponse.ok||uploaded.name!==unicodeName)throw new Error(`unicode upload filename mismatch: ${JSON.stringify(uploaded)}`);
  const textChannel=auth.bootstrap[0].channels.find(item=>item.kind==='text');const unicodeMessage=await request(first,'chat:send',{channelId:textChannel.id,body:'',attachment:uploaded});let history=await request(first,'chat:history',{channelId:textChannel.id});
  if(history.at(-1)?.attachmentName!==unicodeName)throw new Error(`unicode filename was not preserved in history: ${JSON.stringify(history.at(-1))}`);
  const legacyName=Buffer.from(unicodeName,'utf8').toString('latin1');const database=new Database(databasePath);database.prepare('UPDATE messages SET attachment_name=? WHERE id=?').run(legacyName,unicodeMessage.id);database.close();history=await request(first,'chat:history',{channelId:textChannel.id});
  if(history.at(-1)?.attachmentName!==unicodeName)throw new Error(`legacy mojibake filename was not repaired: ${JSON.stringify(history.at(-1))}`);
  const avatarForm=new FormData();avatarForm.append('file',new File([new Uint8Array([71,73,70,56,57,97])],'动态头像.gif',{type:'image/gif'}));const avatarResponse=await fetch(`${origin}/api/uploads`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`},body:avatarForm});const avatarUpload=await avatarResponse.json();
  const updatedEvent=once(second,'user:updated');const updatedUser=await request(first,'user:avatar',{url:avatarUpload.url});const observedUser=await updatedEvent;const members=await request(first,'space:members',{spaceId:auth.bootstrap[0].id});const avatarMessage=await request(first,'chat:send',{channelId:textChannel.id,body:'**Markdown** `avatar`'});const secondSessionMessage=await request(second,'chat:send',{channelId:textChannel.id,body:'avatar from resumed session'});
  if(!avatarResponse.ok||!updatedUser.avatarUrl?.endsWith('.gif')||observedUser.avatarUrl!==updatedUser.avatarUrl||members.find(item=>item.id===auth.user.id)?.avatarUrl!==updatedUser.avatarUrl||avatarMessage.avatarUrl!==updatedUser.avatarUrl||secondSessionMessage.avatarUrl!==updatedUser.avatarUrl)throw new Error(`animated avatar sync failed: ${JSON.stringify({avatarResponse,updatedUser,observedUser,members,avatarMessage,secondSessionMessage})}`);
  const channel=auth.bootstrap[0].channels.find(item=>item.kind==='voice');
  let leaked=false;outsider.on('voice:presence',()=>{leaked=true});
  const firstEvent=presence(first,channel.id);await request(first,'voice:join',{channelId:channel.id});await firstEvent;
  const secondEvent=presence(first,channel.id);await request(second,'voice:join',{channelId:channel.id});const joined=await secondEvent;
  const leaveEvent=presence(first,channel.id);await request(second,'voice:leave');const remaining=await leaveEvent;
  const emptyEvent=presence(first,channel.id);await request(first,'voice:leave');const empty=await emptyEvent;
  await new Promise(resolve=>setTimeout(resolve,250));
  if(leaked||joined.users.length!==1||remaining.users.length!==1||empty.users.length!==0)throw new Error(`scoped presence mismatch: ${JSON.stringify({leaked,joined,remaining,empty})}`);
  console.log(JSON.stringify({localServerRegression:true,unicodeUploadName:uploaded.name,unicodeHistoryName:history.find(item=>item.id===unicodeMessage.id)?.attachmentName,legacyFilenameRepaired:true,animatedAvatar:updatedUser.avatarUrl,avatarRealtimeSync:true,avatarMessageSync:true,voicePresenceScoped:true,unrelatedCommunityLeak:false,joinedUsers:joined.users.length,afterLeave:empty.users.length}));
}finally{
  for(const socket of sockets)socket.close();
  child.kill();
  await new Promise(resolve=>setTimeout(resolve,500));
  rmSync(runtime,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
