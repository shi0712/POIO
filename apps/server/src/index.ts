import http from 'node:http';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { mkdirSync, unlink } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config } from './config.js';
import { bootstrap, channelMessages, channelSpaceId, createChannel, createDirectMessage, createMessage, createSpace, createSpaceInvite, deleteChannel, deleteMessage, directConversations, directMessages, editMessage, joinSpace, login, markDirectMessagesRead, mentionedUserIds, previewSpaceInvite, register, removeSpaceMember, renameChannel, renameSpace, resume, revokeSession, scheduleDatabaseBackups, searchMessages, spaceMemberIds, spaceMembers, toggleMessageReaction, updateAvatar, updateJoinSound, updateLeaveSound, updateMemberModeration, userFromToken, voiceChannelForUser, type PublicUser } from './database.js';
import * as media from './media.js';
import { claimMumbleUsername, ensureVoiceChannel, kickMumbleUser, mumbleChannelName, removeVoiceChannel, setMumbleUserMuted } from './mumble-control.js';

const app = express();
app.use(cors({ origin: config.corsOrigin }));
mkdirSync(config.uploadPath,{recursive:true});
function normalizeUploadFilename(raw:string) {
  let name=raw;
  const latin1=[...raw].every(character=>(character.codePointAt(0)??0)<=255);
  const decoded=latin1?Buffer.from(raw,'latin1').toString('utf8'):raw;
  if(latin1&&!decoded.includes('\uFFFD')&&decoded!==raw&&/[^\x00-\x7F]/.test(decoded))name=decoded;
  name=name.normalize('NFC').replace(/[\u0000-\u001F\u007F]/g,'').trim();
  return Array.from(name||'file').slice(0,255).join('');
}
const upload=multer({storage:multer.diskStorage({destination:config.uploadPath,filename:(_req,file,done)=>{file.originalname=normalizeUploadFilename(file.originalname);done(null,`${nanoid()}${path.extname(file.originalname).slice(0,12)}`)}}),limits:{fileSize:50*1024*1024,files:1}});
app.use('/uploads',express.static(config.uploadPath,{immutable:true,maxAge:'7d',fallthrough:false}));
app.get('/invite/:code',(_req,res)=>res.sendFile(path.resolve(config.downloadPath,'invite.html'),{headers:{'Cache-Control':'no-store'}}));
app.get('/api/invites/:code',(req,res)=>{
  try{
    const invite=previewSpaceInvite(req.params.code);
    res.json({...invite,url:`${config.publicAppUrl.replace(/\/$/,'')}/invite/${invite.code}`});
  }catch(error){
    res.status(404).json({error:error instanceof Error?error.message:'邀请链接不可用'});
  }
});
app.get('/download',(req,res,next)=>req.originalUrl.endsWith('/')?next():res.redirect(308,'./download/'));
app.use('/download',express.static(config.downloadPath,{index:'index.html',maxAge:'5m',fallthrough:false}));
app.get('/releases/latest.yml',(_req,res)=>res.sendFile(path.resolve(config.releasePath,'latest.yml'),{headers:{'Cache-Control':'no-store, no-cache, must-revalidate'}}));
app.use('/releases',express.static(config.releasePath,{immutable:true,maxAge:'1d',fallthrough:false}));
app.post('/api/uploads',upload.single('file'),(req,res)=>{
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,''); const user=token&&userFromToken(token);
  if(!user){if(req.file)unlink(req.file.path,()=>{});res.status(401).json({error:'登录已过期'});return;}
  if(!req.file){res.status(400).json({error:'没有收到文件'});return;}
  res.json({url:`/uploads/${req.file.filename}`,name:req.file.originalname,size:req.file.size,mime:req.file.mimetype||'application/octet-stream'});
});
app.get('/health', (_req, res) => res.json({ ok: true, name: 'POIO', version: '0.6.0' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.corsOrigin }, maxHttpBufferSize: 2_000_000, transports: ['websocket','polling'] });

media.mediaEvents.on('producerClosed', ({channelId,userId,producerId}) => {
  io.to(`media:${channelId}`).emit('media:producerClosed',{producerId,userId});
});

await media.initMedia();
scheduleDatabaseBackups();
type Ack = (response: {ok:true;value:any}|{ok:false;error:string}) => void;
const ok = (ack: Ack, value: any) => ack({ ok: true, value });
const fail = (ack: Ack, error: unknown) => ack({ ok: false, error: error instanceof Error ? error.message : '请求失败' });
const auth = (socket: any): PublicUser => { if (!socket.data.user) throw new Error('请先登录'); return socket.data.user; };
type VoicePresence = { channelId:string; user:PublicUser };
const voicePresence = new Map<string,VoicePresence>();
const recentVoiceDisconnects = new Map<string,{expiresAt:number;timer:NodeJS.Timeout}>();
const onlineSessions = new Map<string,string>();
const voiceUsers = (channelId:string) => [...new Map([...voicePresence.values()].filter(entry=>entry.channelId===channelId).map(entry=>[entry.user.id,entry.user])).values()];
const voicePresenceKey = (channelId:string,userId:string) => `${channelId}:${userId}`;
const broadcastVoicePresence = (channelId:string) => {
  const spaceId=channelSpaceId(channelId);
  if(spaceId)io.to(`space:${spaceId}`).emit('voice:presence',{channelId,users:voiceUsers(channelId)});
};
const broadcastVoiceMemberLeft = (channelId:string,user:PublicUser) => {
  const spaceId=channelSpaceId(channelId);
  if(spaceId)io.to(`space:${spaceId}`).emit('voice:memberLeft',{channelId,user});
};
const onlineUserIds = (spaceId:string) => {
  const members=new Set(spaceMemberIds(spaceId));
  return [...new Set(onlineSessions.values())].filter(userId=>members.has(userId));
};
const broadcastSpacePresence = (spaceId:string) => io.to(`space:${spaceId}`).emit('space:presence',{spaceId,userIds:onlineUserIds(spaceId)});
const attachUser = (socket:any,user:PublicUser,spaces:Array<{id:string}>) => {
  socket.data.user=user;
  socket.data.spaceIds=spaces.map(space=>space.id);
  onlineSessions.set(socket.id,user.id);
  for(const space of spaces)socket.join(`space:${space.id}`);
  for(const space of spaces)broadcastSpacePresence(space.id);
};
const detachUser = (socket:any) => {
  const spaceIds=[...(socket.data.spaceIds??[])];
  onlineSessions.delete(socket.id);
  socket.data.user=undefined;
  socket.data.spaceIds=[];
  for(const spaceId of spaceIds)broadcastSpacePresence(spaceId);
};
const leaveVoice = (socketId:string,unexpected=false) => {
  const previous=voicePresence.get(socketId);
  if(!previous)return;
  voicePresence.delete(socketId);
  const key=voicePresenceKey(previous.channelId,previous.user.id);
  const stillPresent=voiceUsers(previous.channelId).some(user=>user.id===previous.user.id);
  const old=recentVoiceDisconnects.get(key);
  if(old){clearTimeout(old.timer);recentVoiceDisconnects.delete(key)}
  if(!stillPresent&&unexpected){
    const expiresAt=Date.now()+10_000;
    const timer=setTimeout(()=>{
      const recent=recentVoiceDisconnects.get(key);
      if(!recent||recent.timer!==timer)return;
      recentVoiceDisconnects.delete(key);
      if(!voiceUsers(previous.channelId).some(user=>user.id===previous.user.id))broadcastVoiceMemberLeft(previous.channelId,previous.user);
    },10_000);
    timer.unref();
    recentVoiceDisconnects.set(key,{expiresAt,timer});
  }else if(!stillPresent)broadcastVoiceMemberLeft(previous.channelId,previous.user);
  broadcastVoicePresence(previous.channelId);
};
const publishUserUpdate = (updated:PublicUser,spaceIds:string[]) => {
  for(const connected of io.sockets.sockets.values())if(connected.data.user?.id===updated.id)connected.data.user=updated;
  for(const spaceId of spaceIds)io.to(`space:${spaceId}`).emit('user:updated',updated);
  const changedChannels=new Set<string>();
  for(const entry of voicePresence.values())if(entry.user.id===updated.id){entry.user=updated;changedChannels.add(entry.channelId)}
  for(const channelId of changedChannels)broadcastVoicePresence(channelId);
};
const notifyP2PPeerLeft = (socketId:string) => {
  const session=media.peerSession(socketId);if(!session)return;
  io.to(`media:${session.channelId}`).emit('media:p2p:peerLeft',{socketId});
};
const socketsForUser = (userId:string) =>
  [...io.sockets.sockets.values()].filter(connected=>connected.data.user?.id===userId);
const forceUserOutOfSpace = async(spaceId:string,userId:string,reason:string) => {
  const shouldKick=[...voicePresence.values()].some(entry=>entry.user.id===userId&&channelSpaceId(entry.channelId)===spaceId);
  if(shouldKick)await kickMumbleUser(userId,reason).catch(error=>console.error('Mumble member kick failed',error));
  for(const connected of socketsForUser(userId)){
    const presence=voicePresence.get(connected.id);
    if(presence&&channelSpaceId(presence.channelId)===spaceId){
      leaveVoice(connected.id);
      notifyP2PPeerLeft(connected.id);
      media.leaveMedia(connected.id);
      connected.emit('voice:forcedLeave',{spaceId,reason});
    }
    connected.leave(`space:${spaceId}`);
    connected.data.spaceIds=(connected.data.spaceIds??[]).filter((id:string)=>id!==spaceId);
    connected.emit('space:removed',{spaceId,reason});
  }
};

io.on('connection', (socket) => {
  socket.on('app:capabilities', (_raw, ack: Ack) => { ok(ack,{
    protocolVersion:1,
    serverVersion:'0.6.0',
    features:{chat:true,directMessages:true,attachments:true,chatReplies:true,chatEditing:true,chatReactions:true,chatSearch:true,chatMentions:true,animatedAvatars:true,communityLinks:true,mumbleVoice:true,voiceJoinCues:true,voiceLeaveCues:true,customJoinSounds:true,customLeaveSounds:true,screenReceive:true,screenPublish:true,preferredLayers:true,p2pScreenShare:true},
    media:{codecs:['video/H264','video/VP8','audio/opus'],webRtcPort:config.mediaPort},
    android:{minimumVersion:1,recommendedVersion:1}
  }); });
  socket.on('auth:register', async (raw, ack: Ack) => { try {
    const value = z.object({username:z.string().trim().min(2).max(20),password:z.string().min(8).max(128)}).parse(raw);
    const result = await register(value.username, value.password); attachUser(socket,result.user,result.bootstrap); ok(ack, result);
  } catch (e) { fail(ack,e); }});
  socket.on('auth:login', async (raw, ack: Ack) => { try {
    const value = z.object({username:z.string().trim().min(2).max(20),password:z.string().min(1).max(128)}).parse(raw);
    const result = await login(value.username, value.password); attachUser(socket,result.user,result.bootstrap); ok(ack,result);
  } catch(e){fail(ack,e);}});
  socket.on('auth:resume', (raw, ack: Ack) => { try { const result=resume(z.object({token:z.string().min(32)}).parse(raw).token); attachUser(socket,result.user,result.bootstrap); ok(ack,result); } catch(e){fail(ack,e);} });
  socket.on('auth:logout', (raw, ack: Ack) => { try { const {token}=z.object({token:z.string().min(32)}).parse(raw); auth(socket); revokeSession(token); leaveVoice(socket.id); notifyP2PPeerLeft(socket.id); media.leaveMedia(socket.id); detachUser(socket); ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('user:avatar', (raw, ack: Ack) => { try {
    const current=auth(socket);const {url}=z.object({url:z.string().max(300).nullable()}).parse(raw);
    const updated=updateAvatar(current.id,url);publishUserUpdate(updated,[...(socket.data.spaceIds??[])]);
    ok(ack,updated);
  } catch(e){fail(ack,e);} });
  socket.on('user:joinSound', (raw, ack: Ack) => { try {
    const current=auth(socket);const {url}=z.object({url:z.string().max(300).nullable()}).parse(raw);
    const updated=updateJoinSound(current.id,url);publishUserUpdate(updated,[...(socket.data.spaceIds??[])]);
    ok(ack,updated);
  } catch(e){fail(ack,e);} });
  socket.on('user:leaveSound', (raw, ack: Ack) => { try {
    const current=auth(socket);const {url}=z.object({url:z.string().max(300).nullable()}).parse(raw);
    const updated=updateLeaveSound(current.id,url);publishUserUpdate(updated,[...(socket.data.spaceIds??[])]);
    ok(ack,updated);
  } catch(e){fail(ack,e);} });
  socket.on('bootstrap', (_raw, ack: Ack) => { try { ok(ack,bootstrap(auth(socket).id)); } catch(e){fail(ack,e);} });
  socket.on('space:create', (raw, ack: Ack) => { try { const {name}=z.object({name:z.string().trim().min(2).max(32)}).parse(raw); const space=createSpace(auth(socket),name); socket.join(`space:${space.id}`); socket.data.spaceIds=[...(socket.data.spaceIds??[]),space.id]; ok(ack,space); broadcastSpacePresence(space.id); } catch(e){fail(ack,e);} });
  socket.on('space:invite', (raw, ack: Ack) => { try { const {spaceId}=z.object({spaceId:z.string()}).parse(raw); const invite=createSpaceInvite(auth(socket),spaceId);ok(ack,{...invite,url:`${config.publicAppUrl.replace(/\/$/,'')}/invite/${invite.code}`}); } catch(e){fail(ack,e);} });
  socket.on('space:invitePreview', (raw, ack: Ack) => { try { const {code}=z.object({code:z.string().trim().min(6).max(300)}).parse(raw); const invite=previewSpaceInvite(code);ok(ack,{...invite,url:`${config.publicAppUrl.replace(/\/$/,'')}/invite/${invite.code}`}); } catch(e){fail(ack,e);} });
  socket.on('space:join', (raw, ack: Ack) => { try { const {code}=z.object({code:z.string().trim().min(6).max(300)}).parse(raw); const user=auth(socket); const space=joinSpace(user,code); socket.join(`space:${space.id}`); socket.data.spaceIds=[...new Set([...(socket.data.spaceIds??[]),space.id])]; io.to(`space:${space.id}`).emit('space:memberJoined',{spaceId:space.id,user}); ok(ack,space); broadcastSpacePresence(space.id); } catch(e){fail(ack,e);} });
  socket.on('space:members', (raw, ack: Ack) => { try { const {spaceId}=z.object({spaceId:z.string()}).parse(raw); const user=auth(socket); ok(ack,spaceMembers(user.id,spaceId)); } catch(e){fail(ack,e);} });
  socket.on('space:presence', (raw, ack: Ack) => { try { const {spaceId}=z.object({spaceId:z.string()}).parse(raw); const user=auth(socket); spaceMembers(user.id,spaceId); ok(ack,onlineUserIds(spaceId)); } catch(e){fail(ack,e);} });
  socket.on('space:update', (raw, ack: Ack) => { try { const value=z.object({spaceId:z.string(),name:z.string().trim().min(2).max(32)}).parse(raw); const updated=renameSpace(auth(socket),value.spaceId,value.name); io.to(`space:${value.spaceId}`).emit('space:updated',updated); ok(ack,updated); } catch(e){fail(ack,e);} });
  socket.on('space:moderateMember', async (raw, ack: Ack) => { try {
    const value=z.object({spaceId:z.string(),userId:z.string(),textMuted:z.boolean().optional(),voiceMuted:z.boolean().optional()}).refine(item=>item.textMuted!==undefined||item.voiceMuted!==undefined,'没有需要修改的限制').parse(raw);
    const updated=updateMemberModeration(auth(socket),value.spaceId,value.userId,{textMuted:value.textMuted,voiceMuted:value.voiceMuted});
    const targetIsInThisSpace=[...voicePresence.values()].some(entry=>
      entry.user.id===value.userId&&channelSpaceId(entry.channelId)===value.spaceId
    );
    if(value.voiceMuted!==undefined&&targetIsInThisSpace)await setMumbleUserMuted(value.userId,value.voiceMuted);
    io.to(`space:${value.spaceId}`).emit('space:memberModeration',updated);
    for(const connected of socketsForUser(value.userId))connected.emit('space:moderationChanged',updated);
    ok(ack,updated);
  } catch(e){fail(ack,e);} });
  socket.on('space:removeMember', async (raw, ack: Ack) => { try {
    const value=z.object({spaceId:z.string(),userId:z.string()}).parse(raw);
    const removed=removeSpaceMember(auth(socket),value.spaceId,value.userId);
    await forceUserOutOfSpace(value.spaceId,value.userId,'你已被社区拥有者移出社区');
    io.to(`space:${value.spaceId}`).emit('space:memberRemoved',removed);
    broadcastSpacePresence(value.spaceId);
    ok(ack,removed);
  } catch(e){fail(ack,e);} });
  socket.on('channel:create', async (raw, ack: Ack) => { try { const v=z.object({spaceId:z.string(),name:z.string().trim().min(1).max(32),kind:z.enum(['text','voice'])}).parse(raw); const channel=createChannel(auth(socket),v.spaceId,v.name,v.kind); if(channel.kind==='voice')await ensureVoiceChannel(channel.id); io.to(`space:${v.spaceId}`).emit('channel:created',channel); ok(ack,channel); } catch(e){fail(ack,e);} });
  socket.on('channel:update', (raw, ack: Ack) => { try { const value=z.object({channelId:z.string(),name:z.string().trim().min(1).max(32)}).parse(raw); const updated=renameChannel(auth(socket),value.channelId,value.name); io.to(`space:${updated.spaceId}`).emit('channel:updated',updated); ok(ack,updated); } catch(e){fail(ack,e);} });
  socket.on('channel:delete', (raw, ack: Ack) => { try {
    const {channelId}=z.object({channelId:z.string()}).parse(raw);
    const removed=deleteChannel(auth(socket),channelId);
    if(removed.kind==='voice'){
      const affected=[...voicePresence.entries()].filter(([,entry])=>entry.channelId===channelId);
      const users=new Set(affected.map(([,entry])=>entry.user.id));
      for(const userId of users)void kickMumbleUser(userId,'语音频道已被删除').catch(error=>console.error('Mumble channel member kick failed',error));
      for(const [socketId] of affected){
        const connected=io.sockets.sockets.get(socketId);
        leaveVoice(socketId);
        notifyP2PPeerLeft(socketId);
        media.leaveMedia(socketId);
        connected?.emit('voice:forcedLeave',{spaceId:removed.spaceId,channelId,reason:'语音频道已被删除'});
      }
      void removeVoiceChannel(channelId).catch(error=>console.error('Mumble channel removal failed',error));
    }
    io.to(`space:${removed.spaceId}`).emit('channel:deleted',removed);
    ok(ack,removed);
  } catch(e){fail(ack,e);} });
  socket.on('chat:history', (raw, ack: Ack) => { try { ok(ack,channelMessages(auth(socket).id,z.object({channelId:z.string()}).parse(raw).channelId)); } catch(e){fail(ack,e);} });
  socket.on('chat:send', (raw, ack: Ack) => { try {
    const v=z.object({
      channelId:z.string(),
      body:z.string().trim().max(4000).default(''),
      replyToId:z.string().optional(),
      attachment:z.object({url:z.string().startsWith('/uploads/'),name:z.string().min(1).max(255),size:z.number().int().max(50*1024*1024),mime:z.string().max(128)}).optional(),
    }).refine(value=>value.body.length>0||value.attachment,'消息不能为空').parse(raw);
    const user=auth(socket);
    const msg=createMessage(user,v.channelId,v.body,v.attachment,v.replyToId);
    io.to(`channel:${v.channelId}`).emit('chat:message',msg);
    const mentions=mentionedUserIds(v.channelId,v.body).filter(userId=>userId!==user.id);
    for(const userId of mentions)for(const connected of socketsForUser(userId))connected.emit('chat:mention',{channelId:v.channelId,message:msg});
    const spaceId=channelSpaceId(v.channelId);
    if(spaceId)io.to(`space:${spaceId}`).emit('chat:activity',{channelId:v.channelId,messageId:msg.id,userId:user.id,mentionedUserIds:mentions});
    ok(ack,msg);
  } catch(e){fail(ack,e);} });
  socket.on('chat:edit', (raw, ack: Ack) => { try {
    const value=z.object({messageId:z.string(),body:z.string().trim().max(4000)}).parse(raw);
    const msg=editMessage(auth(socket),value.messageId,value.body);
    io.to(`channel:${msg.channelId}`).emit('chat:messageUpdated',msg);
    ok(ack,msg);
  } catch(e){fail(ack,e);} });
  socket.on('chat:delete', (raw, ack: Ack) => { try {
    const value=z.object({messageId:z.string()}).parse(raw);
    const msg=deleteMessage(auth(socket),value.messageId);
    io.to(`channel:${msg.channelId}`).emit('chat:messageUpdated',msg);
    ok(ack,msg);
  } catch(e){fail(ack,e);} });
  socket.on('chat:react', (raw, ack: Ack) => { try {
    const value=z.object({messageId:z.string(),emoji:z.string().min(1).max(8)}).parse(raw);
    const msg=toggleMessageReaction(auth(socket),value.messageId,value.emoji);
    io.to(`channel:${msg.channelId}`).emit('chat:messageUpdated',msg);
    ok(ack,msg);
  } catch(e){fail(ack,e);} });
  socket.on('chat:search', (raw, ack: Ack) => { try {
    const value=z.object({channelId:z.string(),query:z.string().trim().min(1).max(100)}).parse(raw);
    ok(ack,searchMessages(auth(socket).id,value.channelId,value.query));
  } catch(e){fail(ack,e);} });
  socket.on('dm:list', (_raw, ack: Ack) => { try {
    ok(ack,directConversations(auth(socket).id));
  } catch(e){fail(ack,e);} });
  socket.on('dm:history', (raw, ack: Ack) => { try {
    const {peerId}=z.object({peerId:z.string()}).parse(raw);
    ok(ack,directMessages(auth(socket).id,peerId));
  } catch(e){fail(ack,e);} });
  socket.on('dm:send', (raw, ack: Ack) => { try {
    const value=z.object({
      peerId:z.string(),
      body:z.string().trim().max(4000).default(''),
      attachment:z.object({url:z.string().startsWith('/uploads/'),name:z.string().min(1).max(255),size:z.number().int().max(50*1024*1024),mime:z.string().max(128)}).optional(),
    }).refine(item=>item.body.length>0||item.attachment,'消息不能为空').parse(raw);
    const user=auth(socket);
    const message=createDirectMessage(user,value.peerId,value.body,value.attachment);
    for(const userId of [user.id,value.peerId])for(const connected of socketsForUser(userId))connected.emit('dm:message',message);
    ok(ack,message);
  } catch(e){fail(ack,e);} });
  socket.on('dm:read', (raw, ack: Ack) => { try {
    const user=auth(socket);
    const {peerId}=z.object({peerId:z.string()}).parse(raw);
    const receipt=markDirectMessagesRead(user.id,peerId);
    for(const connected of socketsForUser(peerId))connected.emit('dm:read',{userId:user.id,...receipt});
    ok(ack,receipt);
  } catch(e){fail(ack,e);} });
  socket.on('channel:watch', (raw, ack: Ack) => { try { const channelId=z.object({channelId:z.string()}).parse(raw).channelId; const user=auth(socket); const spaceId=channelSpaceId(channelId);if(!spaceId)throw new Error('频道不存在');spaceMembers(user.id,spaceId);for (const room of socket.rooms) if(room.startsWith('channel:')) socket.leave(room); socket.join(`channel:${channelId}`); ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('voice:credentials', async (raw, ack: Ack) => { try {
    const user=auth(socket);
    const channel=voiceChannelForUser(user.id,z.object({channelId:z.string()}).parse(raw).channelId);
    const username=`ed_${user.id}`;
    const existingPresence=voicePresence.get(socket.id);
    await ensureVoiceChannel(channel.id);
    // A client already present in voice is switching channels. Its native
    // Mumble process must stay alive so Electron can MOVE it in place. Only
    // claim the username for a new/recovered session, where an old process may
    // genuinely be stale and needs replacing.
    if(!existingPresence||existingPresence.user.id!==user.id)await claimMumbleUsername(username);
    ok(ack,{host:config.mumbleHost,port:config.mumblePort,username,password:config.mumblePassword,channelName:mumbleChannelName(channel.id),voiceMuted:channel.voiceMuted});
  } catch(e){fail(ack,e);} });
  socket.on('voice:join', async (raw, ack: Ack) => { try {
    const user=auth(socket);const channel=voiceChannelForUser(user.id,z.object({channelId:z.string()}).parse(raw).channelId);
    if(channel.voiceMuted)await setMumbleUserMuted(user.id,true);
    leaveVoice(socket.id);
    const alreadyPresent=voiceUsers(channel.id).some(member=>member.id===user.id);
    const reconnectKey=voicePresenceKey(channel.id,user.id);const recent=recentVoiceDisconnects.get(reconnectKey);
    const reconnecting=!!recent&&recent.expiresAt>Date.now();
    if(recent){clearTimeout(recent.timer);recentVoiceDisconnects.delete(reconnectKey)}
    voicePresence.set(socket.id,{channelId:channel.id,user});broadcastVoicePresence(channel.id);
    const spaceId=channelSpaceId(channel.id);
    if(spaceId&&!alreadyPresent&&!reconnecting)socket.to(`space:${spaceId}`).emit('voice:memberJoined',{channelId:channel.id,user});
    ok(ack,{channelId:channel.id,users:voiceUsers(channel.id),moderation:{voiceMuted:channel.voiceMuted}});
  } catch(e){fail(ack,e);} });
  socket.on('voice:leave', (_raw, ack: Ack) => { try { auth(socket); leaveVoice(socket.id); ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('media:capabilities', (_raw, ack: Ack) => { try { auth(socket); ok(ack,media.rtpCapabilities()); } catch(e){fail(ack,e);} });
  socket.on('media:join', (raw, ack: Ack) => { try {
    const value=z.object({channelId:z.string(),p2p:z.boolean().optional()}).parse(raw);const user=auth(socket);
    voiceChannelForUser(user.id,value.channelId);notifyP2PPeerLeft(socket.id);
    for(const room of socket.rooms)if(room.startsWith('media:'))socket.leave(room);
    const peers=media.joinMedia(socket.id,user.id,value.channelId,value.p2p===true);
    socket.join(`media:${value.channelId}`);socket.to(`media:${value.channelId}`).emit('media:peerJoined',{socketId:socket.id,user,p2pCapable:value.p2p===true});
    ok(ack,{peers,producers:media.roomProducers(socket.id),p2pEnabled:true,p2pShares:media.p2pShares(socket.id),iceServers:config.p2pIceServers});
  } catch(e){fail(ack,e);} });
  socket.on('media:leave', (_raw, ack: Ack) => { try { auth(socket); notifyP2PPeerLeft(socket.id);media.leaveMedia(socket.id); for(const room of socket.rooms)if(room.startsWith('media:'))socket.leave(room); ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('media:createTransport', (_raw, ack: Ack) => { void media.createTransport(socket.id).then((v)=>ok(ack,v)).catch((e)=>fail(ack,e)); });
  socket.on('media:connectTransport', (raw, ack: Ack) => { void media.connectTransport(socket.id,raw.transportId,raw.dtlsParameters).then(()=>ok(ack,true)).catch((e)=>fail(ack,e)); });
  socket.on('media:closeTransport', (raw, ack: Ack) => { try { auth(socket);const {transportId}=z.object({transportId:z.string()}).parse(raw);media.closeTransport(socket.id,transportId);ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('media:produce', (raw, ack: Ack) => { void media.produce(socket.id,raw.transportId,raw.kind,raw.rtpParameters,raw.appData).then((v)=>{ socket.to(`media:${v.channelId}`).emit('media:newProducer',{producerId:v.id,userId:v.userId,kind:v.kind,appData:v.appData}); ok(ack,{id:v.id}); }).catch((e)=>fail(ack,e)); });
  socket.on('media:consume', (raw, ack: Ack) => { void media.consume(socket.id,raw.transportId,raw.producerId,raw.rtpCapabilities).then((v)=>ok(ack,v)).catch((e)=>fail(ack,e)); });
  socket.on('media:resumeConsumer', (raw, ack: Ack) => { void media.resumeConsumer(socket.id,raw.consumerId).then(()=>ok(ack,true)).catch((e)=>fail(ack,e)); });
  socket.on('media:closeConsumer', (raw, ack: Ack) => { try { auth(socket);const {consumerId}=z.object({consumerId:z.string()}).parse(raw);media.closeConsumer(socket.id,consumerId);ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('media:setPreferredLayers', (raw, ack: Ack) => { try { auth(socket); const value=z.object({consumerId:z.string(),spatialLayer:z.number().int().min(0).max(2),temporalLayer:z.number().int().min(0).max(2).optional()}).parse(raw); void media.setPreferredLayers(socket.id,value.consumerId,value.spatialLayer,value.temporalLayer).then(result=>ok(ack,result)).catch(error=>fail(ack,error)); } catch(e){fail(ack,e);} });
  socket.on('media:closeProducer', (raw, ack: Ack) => { try { media.closeProducer(socket.id,raw.producerId); ok(ack,true); } catch(e){fail(ack,e);} });
  socket.on('media:p2p:announce', (raw, ack: Ack) => { try {
    auth(socket);const value=z.object({profile:z.string().max(32),hasAudio:z.boolean()}).parse(raw);
    const announced=media.announceP2PShare(socket.id,value);
    socket.to(`media:${announced.channelId}`).emit('media:p2p:shareStarted',announced.share);ok(ack,announced.share);
  } catch(e){fail(ack,e);} });
  socket.on('media:p2p:stop', (_raw, ack: Ack) => { try {
    auth(socket);const stopped=media.stopP2PShare(socket.id);
    if(stopped)io.to(`media:${stopped.channelId}`).emit('media:p2p:shareStopped',{socketId:socket.id});ok(ack,true);
  } catch(e){fail(ack,e);} });
  socket.on('media:p2p:watch', (raw, ack: Ack) => { try {
    auth(socket);const {sharerSocketId}=z.object({sharerSocketId:z.string()}).parse(raw);
    const session=media.requestP2PWatch(socket.id,sharerSocketId);
    io.to(sharerSocketId).emit('media:p2p:watchRequested',{viewerSocketId:socket.id,viewerUserId:session.viewerUserId});
    ok(ack,true);
  } catch(e){fail(ack,e);} });
  socket.on('media:p2p:signal', (raw, ack: Ack) => { try {
    auth(socket);const value=z.object({targetSocketId:z.string(),description:z.any().optional(),candidate:z.any().optional()})
      .refine(item=>item.description!==undefined||item.candidate!==undefined,'缺少 WebRTC 信令').parse(raw);
    if(!media.canSignalP2P(socket.id,value.targetSocketId))throw new Error('无权发送该 P2P 信令');
    io.to(value.targetSocketId).emit('media:p2p:signal',{fromSocketId:socket.id,userId:auth(socket).id,description:value.description,candidate:value.candidate});
    ok(ack,true);
  } catch(e){fail(ack,e);} });
  socket.on('media:p2p:disconnect', (raw, ack: Ack) => { try {
    auth(socket);const {peerSocketId}=z.object({peerSocketId:z.string()}).parse(raw);
    const disconnected=media.disconnectP2P(socket.id,peerSocketId);
    if(disconnected){io.to(disconnected.sharerSocketId).emit('media:p2p:peerDisconnected',{socketId:disconnected.viewerSocketId});io.to(disconnected.viewerSocketId).emit('media:p2p:peerDisconnected',{socketId:disconnected.sharerSocketId});}
    ok(ack,true);
  } catch(e){fail(ack,e);} });
  socket.on('disconnect', () => { leaveVoice(socket.id,true);notifyP2PPeerLeft(socket.id);media.leaveMedia(socket.id);detachUser(socket); });
});

server.listen(config.port, config.host, () => console.log(`POIO server listening on ${config.host}:${config.port}`));
