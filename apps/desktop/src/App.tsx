import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleDot } from 'lucide-react';
import { BellRing, Check, ChevronDown, CirclePlus, Code2, Copy, Crown, Download, Eye, FileText, Gamepad2, Hash, HeadphoneOff, Headphones, Image, Keyboard, Link2, LogIn, LogOut, Maximize2, MessageCircle, MessageSquareOff, Mic, MicOff, Minimize2, Minus, MonitorUp, Pencil, PhoneOff, Play, Plus, Power, Quote, Save, Scissors, Search, Send, Settings, Shield, Smile, Square, Strikethrough, Swords, Trash2, Upload, UserMinus, UserPlus, Users, Volume2, VolumeX, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { request, serverUrl, socket, uploadFile, type AuthPayload, type Channel, type ChatMessage, type DirectConversation, type DirectMessage, type Space, type SpaceMember, type User } from './api';
import { ScreenSession, type RemoteMedia, type ScreenDiagnostics, type ScreenShareStatus, type ShareProfile } from './media';
import { playDeafenCue, playMuteCue, playUndeafenCue, playUnmuteCue, playVoiceJoinCue, playVoiceLeaveCue, validateJoinSound, validateLeaveSound } from './voice-join-cue';
import GameCenter from './GameCenter';
import './fixes.css';

const TOKEN_KEY='echodeck.session';
const LAST_SPACE_KEY='poio.last-space';
const PENDING_INVITE_KEY='poio.pending-invite';
const VOICE_JOIN_CUES_KEY='poio.voice-join-cues-enabled';
const CHAT_DRAFTS_KEY='poio.chat-drafts';
const MESSAGE_REACTIONS=['👍','❤️','😂','😮','😢','😡','🎉','👏','🔥','✅','❌','👀'];
const channelIcon=(kind:string)=>kind==='voice'?<Volume2 size={17}/>:<Hash size={17}/>;
const spaceInitial=(name:string)=>(Array.from(name.trim())[0]??'?').toLocaleUpperCase('en-US');
const electronBridge=()=>{const bridge=window.echodeck;if(!bridge?.mumble)throw new Error('Electron 桥接未加载，请安装 POIO 0.2.0 或更高版本后重启客户端');return bridge};
type ScreenshotCapture={dataUrl:string;width:number;height:number;displayName:string};
type QueuedScreenshot={file:File;url:string};
type SpaceInvite={code:string;spaceId:string;spaceName:string;expiresAt:number;url:string};
type InvitePreview=SpaceInvite&{memberCount:number};
type GomokuInvitation={spaceId:string;roomId:string;wager:number;pot:number;inviter:User;expiresAt:number};
type TexasInvitation={spaceId:string;roomId:string;buyIn:number;smallBlind:number;inviter:User;expiresAt:number};
type PoolInvitation={spaceId:string;roomId:string;wager:number;pot:number;inviter:User;expiresAt:number};
type DirectGameInvitation={gameId:'gomoku'|'texas-holdem'|'pool';spaceId:string;roomId:string;wager:number;pot:number;expiresAt:number;metadata?:Record<string,unknown>};
const DIRECT_GOMOKU_INVITE_PREFIX='[[POIO:GOMOKU:INVITE:1]]|';
function parseDirectGameInvitation(body:string):DirectGameInvitation|undefined{
  if(body.startsWith('[[POIO:GAME:INVITE:1]]|'))try{let encoded=body.slice(body.indexOf('|')+1).replace(/-/g,'+').replace(/_/g,'/');encoded+='='.repeat((4-encoded.length%4)%4);const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));const value=JSON.parse(new TextDecoder().decode(bytes));if(['gomoku','texas-holdem','pool'].includes(value.gameId)&&value.spaceId&&value.roomId)return {gameId:value.gameId,spaceId:value.spaceId,roomId:value.roomId,wager:Number(value.wager)||0,pot:Number(value.pot)||0,expiresAt:Number(value.expiresAt)||0,metadata:value.metadata};}catch{return undefined}
  if(!body.startsWith(DIRECT_GOMOKU_INVITE_PREFIX))return;
  const [spaceId,roomId,wagerRaw,potRaw,expiresRaw]=body.slice(DIRECT_GOMOKU_INVITE_PREFIX.length).split('|');
  const wager=Number(wagerRaw),pot=Number(potRaw),expiresAt=Number(expiresRaw);
  if(!spaceId||!roomId||!Number.isSafeInteger(wager)||!Number.isSafeInteger(pot)||!Number.isSafeInteger(expiresAt))return;
  return {gameId:'gomoku',spaceId,roomId,wager,pot,expiresAt};
}
const directMessagePreview=(body:string,attachmentName?:string)=>{const invitation=parseDirectGameInvitation(body);return invitation?(invitation.gameId==='gomoku'?'五子棋对局邀请':invitation.gameId==='pool'?'8 球台球邀请':'德州扑克牌桌邀请'):body||attachmentName||'附件'};

export default function App(){
  const [user,setUser]=useState<User>(); const [spaces,setSpaces]=useState<Space[]>([]); const [spaceId,setSpaceId]=useState(''); const [channelId,setChannelId]=useState('');
  const [messages,setMessages]=useState<ChatMessage[]>([]); const [body,setBody]=useState(''); const [replyingTo,setReplyingTo]=useState<ChatMessage>(); const [editingMessage,setEditingMessage]=useState<ChatMessage>(); const editDraftBackup=useRef(''); const drafts=useRef<Record<string,string>>((()=>{try{return JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY)??'{}')}catch{return {}}})()); const [reactionMessageId,setReactionMessageId]=useState(''); const [messageSearchOpen,setMessageSearchOpen]=useState(false); const [messageSearchQuery,setMessageSearchQuery]=useState(''); const [messageSearchResults,setMessageSearchResults]=useState<ChatMessage[]>([]); const [messageSearchBusy,setMessageSearchBusy]=useState(false); const [mentionedChannels,setMentionedChannels]=useState<Record<string,boolean>>({}); const [error,setError]=useState(''); const errorTimer=useRef(0); const lastError=useRef({message:'',time:0}); const [loading,setLoading]=useState(true); const [uploading,setUploading]=useState(false); const [dropActive,setDropActive]=useState(false); const [imagePreview,setImagePreview]=useState<{url:string;name:string}>(); const fileRef=useRef<HTMLInputElement>(null); const avatarRef=useRef<HTMLInputElement>(null); const composerInputRef=useRef<HTMLTextAreaElement>(null); const messageListRef=useRef<HTMLDivElement>(null); const messageFeedRef=useRef<HTMLDivElement>(null); const stickToLatestRef=useRef(true); const [messageAtBottom,setMessageAtBottom]=useState(true);
  const [screenshot,setScreenshot]=useState<ScreenshotCapture>(); const [pendingScreenshot,setPendingScreenshot]=useState<QueuedScreenshot>(); const [composerExpanded,setComposerExpanded]=useState(false); const [composerPreview,setComposerPreview]=useState(false); const [avatarUploading,setAvatarUploading]=useState(false);
  const [voiceChannel,setVoiceChannel]=useState(''); const [joiningVoiceChannel,setJoiningVoiceChannel]=useState(''); const [muted,setMuted]=useState(false); const [voiceServerMuted,setVoiceServerMuted]=useState(false); const [deafened,setDeafened]=useState(false); const [transmitting,setTransmitting]=useState(false); const [pushToTalkActive,setPushToTalkActive]=useState(false); const [micLevel,setMicLevel]=useState(0); const [inputVolume,setInputVolume]=useState(100); const [outputVolume,setOutputVolume]=useState(100); const volumeTimer=useRef(0); const [memberVolumes,setMemberVolumes]=useState<Record<string,number>>({}); const [talkingMembers,setTalkingMembers]=useState<Record<string,boolean>>({}); const memberVolumeTimers=useRef<Record<string,number>>({}); const [voiceMembers,setVoiceMembers]=useState<Record<string,User[]>>({}); const [remoteMedia,setRemoteMedia]=useState<RemoteMedia[]>([]);
  const voiceJoinEpoch=useRef(0);
  const voiceSwitchQueue=useRef<Promise<void>>(Promise.resolve());
  const previousAudioControls=useRef({muted:false,deafened:false});
  const [shareOpen,setShareOpen]=useState(false); const [sources,setSources]=useState<Array<any>>([]); const [shareSourcesLoading,setShareSourcesLoading]=useState(false); const [shareSourcesError,setShareSourcesError]=useState(''); const shareSourceEpoch=useRef(0); const [shareProfile,setShareProfile]=useState<ShareProfile>('hd'); const [shareAudio,setShareAudio]=useState(false); const [localShare,setLocalShare]=useState<MediaStream>();
  const [screenShareStatus,setScreenShareStatus]=useState<ScreenShareStatus>({sharing:false,connecting:false,directViewers:0,turnViewers:0,viewers:[]});
  const [settingsOpen,setSettingsOpen]=useState(false); const [audioDevices,setAudioDevices]=useState<MumbleAudioDevices>(); const [settingsBusy,setSettingsBusy]=useState(false); const [joinSoundBusy,setJoinSoundBusy]=useState(false); const [leaveSoundBusy,setLeaveSoundBusy]=useState(false); const [voiceJoinCuesEnabled,setVoiceJoinCuesEnabled]=useState(()=>localStorage.getItem(VOICE_JOIN_CUES_KEY)!=='0');
  const [spaceDialog,setSpaceDialog]=useState<'create'|'join'>(); const [channelDialog,setChannelDialog]=useState<'text'|'voice'>(); const [invite,setInvite]=useState<SpaceInvite>(); const [managementOpen,setManagementOpen]=useState(false); const [incomingInvite,setIncomingInvite]=useState<InvitePreview>(); const [incomingInviteLoading,setIncomingInviteLoading]=useState(false); const [incomingInviteJoining,setIncomingInviteJoining]=useState(false); const [spaceMembers,setSpaceMembers]=useState<SpaceMember[]>([]); const [onlineUserIds,setOnlineUserIds]=useState<string[]>([]); const [membersOpen,setMembersOpen]=useState(true); const [emojiOpen,setEmojiOpen]=useState(false); const [accountOpen,setAccountOpen]=useState(false); const [channelQuery,setChannelQuery]=useState(''); const channelSearchRef=useRef<HTMLInputElement>(null);
  const [updateStatus,setUpdateStatus]=useState<AppUpdateStatus>({state:'idle'});
  const [updateDialogOpen,setUpdateDialogOpen]=useState(false);
  const [mumbleState,setMumbleState]=useState<MumbleRuntimeState>({state:'disconnected'});
  const [unreadChannels,setUnreadChannels]=useState<Record<string,number>>({});
  const [directPeer,setDirectPeer]=useState<User>();
  const [directMessages,setDirectMessages]=useState<DirectMessage[]>([]);
  const [directConversations,setDirectConversations]=useState<DirectConversation[]>([]);
  const [directUnread,setDirectUnread]=useState<Record<string,number>>({});
  const [reconnectEpoch,setReconnectEpoch]=useState(0);
  const [gameOpen,setGameOpen]=useState(false);
  const [gomokuInvitation,setGomokuInvitation]=useState<GomokuInvitation>();
  const [texasInvitation,setTexasInvitation]=useState<TexasInvitation>();
  const [poolInvitation,setPoolInvitation]=useState<PoolInvitation>();
  const [pendingGameJoin,setPendingGameJoin]=useState<{gameId:'gomoku'|'texas-holdem'|'pool';roomId:string}>();
  const gomokuInvitationTimer=useRef(0);
  const texasInvitationTimer=useRef(0);
  const poolInvitationTimer=useRef(0);
  const showError=(e:unknown)=>{const message=e instanceof Error?e.message:'发生错误';const now=Date.now();if(lastError.current.message===message&&now-lastError.current.time<10000)return;lastError.current={message,time:now};window.clearTimeout(errorTimer.current);setError(message);errorTimer.current=window.setTimeout(()=>setError(''),3500)};
  const screen=useMemo(()=>new ScreenSession(
    setRemoteMedia,
    setScreenShareStatus,
    error=>{
      setLocalShare(current=>{
        current?.getTracks().forEach(track=>track.stop());
        return undefined;
      });
      showError(error);
    },
  ),[]);
  const currentSpace=spaces.find(s=>s.id===spaceId)??spaces[0]; const currentChannel=currentSpace?.channels.find(c=>c.id===channelId)??currentSpace?.channels[0];
  const isSpaceOwner=currentSpace?.ownerId===user?.id; const selfMembership=spaceMembers.find(member=>member.id===user?.id); const textMuted=selfMembership?.textMuted===true;
  const onlineSet=new Set(onlineUserIds); const onlineMembers=spaceMembers.filter(member=>onlineSet.has(member.id)); const offlineMembers=spaceMembers.filter(member=>!onlineSet.has(member.id)); const visibleVoiceMembers=currentChannel?.kind==='voice'?(voiceMembers[currentChannel.id]??[]):[];
  const updateComposerBody=(value:string)=>{
    setBody(value);
    if(!channelId||editingMessage)return;
    if(value)drafts.current[channelId]=value;else delete drafts.current[channelId];
    localStorage.setItem(CHAT_DRAFTS_KEY,JSON.stringify(drafts.current));
  };
  const restoreDraftAfterEditing=()=>{setEditingMessage(undefined);setBody(editDraftBackup.current);editDraftBackup.current=''};

  useEffect(()=>{if(!spaces.length)return;const nextSpace=spaces.find(space=>space.id===spaceId)??spaces[0];if(nextSpace.id!==spaceId){setSpaceId(nextSpace.id);localStorage.setItem(LAST_SPACE_KEY,nextSpace.id)}if(!nextSpace.channels.some(channel=>channel.id===channelId))setChannelId(nextSpace.channels[0]?.id??'')},[channelId,spaceId,spaces]);
  useEffect(()=>{setBody(drafts.current[channelId]??'');setReplyingTo(undefined);setEditingMessage(undefined);setReactionMessageId('');setMessageSearchOpen(false);setMessageSearchQuery('');setMessageSearchResults([]);setMentionedChannels(current=>({...current,[channelId]:false}))},[channelId]);
  useEffect(()=>{ const expired=()=>window.location.reload();window.addEventListener('poio:session-expired',expired);const token=localStorage.getItem(TOKEN_KEY); if(!token){setLoading(false);return()=>window.removeEventListener('poio:session-expired',expired);} request<AuthPayload>('auth:resume',{token}).then(applyAuth).catch(()=>localStorage.removeItem(TOKEN_KEY)).finally(()=>setLoading(false)); return()=>{window.removeEventListener('poio:session-expired',expired);screen.close()}; },[]);
  useEffect(()=>{const mumble=window.echodeck?.mumble;if(!mumble)return;void mumble.state().then(setMumbleState);return mumble.onState(setMumbleState)},[]);
  useEffect(()=>{const mumble=window.echodeck?.mumble;if(!mumble)return;return mumble.onControls(status=>{setMuted(status.muted);setDeafened(status.deafened);setTransmitting(status.transmitting);setPushToTalkActive(status.pushToTalkActive)})},[]);
  useEffect(()=>{const bridge=window.echodeck?.invite;if(!bridge)return;let disposed=false;const load=async(code:string)=>{if(!code||disposed)return;localStorage.setItem(PENDING_INVITE_KEY,code);setIncomingInviteLoading(true);try{const preview=await request<InvitePreview>('space:invitePreview',{code});if(!disposed)setIncomingInvite(preview)}catch(e){if(!disposed){localStorage.removeItem(PENDING_INVITE_KEY);setIncomingInvite(undefined);showError(e)}}finally{if(!disposed)setIncomingInviteLoading(false)}};const receive=async()=>{const code=await bridge.pending();if(code)await load(code)};const remembered=localStorage.getItem(PENDING_INVITE_KEY);if(remembered)void load(remembered);void receive();const remove=bridge.onReceived(()=>void receive());return()=>{disposed=true;remove()}},[]);
  useEffect(()=>{const disconnected=()=>{screen.close();setLocalShare(undefined)};const restored=()=>setReconnectEpoch(value=>value+1);window.addEventListener('poio:socket-disconnected',disconnected);window.addEventListener('poio:session-restored',restored);return()=>{window.removeEventListener('poio:socket-disconnected',disconnected);window.removeEventListener('poio:session-restored',restored)}},[screen]);
  useEffect(()=>{
    const created=(channel:Channel)=>setSpaces(all=>all.map(space=>space.id===channel.spaceId?{...space,channels:space.channels.some(item=>item.id===channel.id)?space.channels:[...space.channels,channel]}:space));
    const updated=(channel:Channel)=>setSpaces(all=>all.map(space=>space.id===channel.spaceId?{...space,channels:space.channels.map(item=>item.id===channel.id?channel:item)}:space));
    const deleted=(channel:Channel)=>{setSpaces(all=>all.map(space=>space.id===channel.spaceId?{...space,channels:space.channels.filter(item=>item.id!==channel.id)}:space));setChannelId(current=>current===channel.id?'':current)};
    const spaceUpdated=(event:{spaceId:string;name:string})=>setSpaces(all=>all.map(space=>space.id===event.spaceId?{...space,name:event.name}:space));
    socket.on('channel:created',created);socket.on('channel:updated',updated);socket.on('channel:deleted',deleted);socket.on('space:updated',spaceUpdated);
    return()=>{socket.off('channel:created',created);socket.off('channel:updated',updated);socket.off('channel:deleted',deleted);socket.off('space:updated',spaceUpdated)};
  },[]);
  useEffect(()=>{ const presence=(event:{channelId:string;users:User[]})=>setVoiceMembers(all=>({...all,[event.channelId]:event.users})); socket.on('voice:presence',presence); return()=>{socket.off('voice:presence',presence)}; },[]);
  useEffect(()=>{
    const joined=(event:{channelId:string;user:User})=>{
      if(!voiceJoinCuesEnabled||event.channelId!==voiceChannel||event.user.id===user?.id)return;
      void playVoiceJoinCue(event.user.joinSoundUrl?`${serverUrl}${event.user.joinSoundUrl}`:undefined);
    };
    socket.on('voice:memberJoined',joined);
    return()=>{socket.off('voice:memberJoined',joined)};
  },[user?.id,voiceChannel,voiceJoinCuesEnabled]);
  useEffect(()=>{
    const left=(event:{channelId:string;user:User})=>{
      if(!voiceJoinCuesEnabled||event.channelId!==voiceChannel||event.user.id===user?.id)return;
      void playVoiceLeaveCue(event.user.leaveSoundUrl?`${serverUrl}${event.user.leaveSoundUrl}`:undefined);
    };
    socket.on('voice:memberLeft',left);
    return()=>{socket.off('voice:memberLeft',left)};
  },[user?.id,voiceChannel,voiceJoinCuesEnabled]);
  useEffect(()=>{
    const previous=previousAudioControls.current;
    if(voiceChannel){
      if(deafened!==previous.deafened){
        if(deafened)void playDeafenCue();
        else void playUndeafenCue();
      }else if(muted!==previous.muted){
        if(muted)void playMuteCue();
        else void playUnmuteCue();
      }
    }
    previousAudioControls.current={muted,deafened};
  },[muted,deafened,voiceChannel]);
  useEffect(()=>{const updated=(next:User)=>{setUser(current=>current?.id===next.id?next:current);setSpaceMembers(all=>all.map(member=>member.id===next.id?{...member,...next}:member));setVoiceMembers(all=>Object.fromEntries(Object.entries(all).map(([key,members])=>[key,members.map(member=>member.id===next.id?{...member,...next}:member)])));setMessages(all=>all.map(message=>message.userId===next.id?{...message,avatarUrl:next.avatarUrl}:message));setDirectPeer(current=>current?.id===next.id?next:current);setDirectConversations(all=>all.map(item=>item.user.id===next.id?{...item,user:next}:item));setDirectMessages(all=>all.map(message=>message.senderId===next.id?{...message,username:next.username,avatarUrl:next.avatarUrl}:message))};socket.on('user:updated',updated);return()=>{socket.off('user:updated',updated)}},[]);
  useEffect(()=>{if(!channelId||!user)return;let disposed=false;stickToLatestRef.current=true;setMessageAtBottom(true);setMessages([]);request('channel:watch',{channelId}).catch(showError);request<ChatMessage[]>('chat:history',{channelId}).then(value=>{if(!disposed)setMessages(value.slice(-500))}).catch(showError);const incoming=(m:ChatMessage)=>{if(!disposed&&m.channelId===channelId)setMessages(v=>[...v,m].slice(-500))};const updated=(m:ChatMessage)=>{if(!disposed&&m.channelId===channelId)setMessages(v=>v.map(item=>item.id===m.id?m:item))};socket.on('chat:message',incoming);socket.on('chat:messageUpdated',updated);return()=>{disposed=true;socket.off('chat:message',incoming);socket.off('chat:messageUpdated',updated)}},[channelId,user,reconnectEpoch]);
  useLayoutEffect(()=>{const list=messageListRef.current;if(!list||!stickToLatestRef.current)return;list.scrollTop=list.scrollHeight;setMessageAtBottom(true)},[messages,channelId]);
  useEffect(()=>{const list=messageListRef.current;const feed=messageFeedRef.current;if(!list||!feed||typeof ResizeObserver==='undefined')return;let frame=0;const observer=new ResizeObserver(()=>{if(!stickToLatestRef.current)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{list.scrollTop=list.scrollHeight;setMessageAtBottom(true)})});observer.observe(feed);observer.observe(list);return()=>{observer.disconnect();cancelAnimationFrame(frame)}},[user]);
  useLayoutEffect(()=>{const input=composerInputRef.current;if(!input)return;input.style.height='25px';const height=composerExpanded?Math.max(25,input.scrollHeight):Math.min(120,Math.max(25,input.scrollHeight));input.style.height=`${height}px`;input.style.overflowY=!composerExpanded&&input.scrollHeight>120?'auto':'hidden';if(!body)input.scrollTop=0},[body,composerExpanded,composerPreview]);
  useEffect(()=>{if(!reconnectEpoch||!voiceChannel)return;request<{channelId:string;users:User[];moderation:{voiceMuted:boolean}}>('voice:join',{channelId:voiceChannel}).then(presence=>{setVoiceMembers(all=>({...all,[voiceChannel]:presence.users}));setVoiceServerMuted(presence.moderation.voiceMuted)}).catch(showError);screen.join(voiceChannel).catch(showError)},[reconnectEpoch,voiceChannel,screen]);
  useEffect(()=>{let disposed=false;let timer=0;const poll=async()=>{try{const level=await electronBridge().mumble.level();if(!disposed)setMicLevel(level)}catch{if(!disposed)setMicLevel(0)}finally{if(!disposed)timer=window.setTimeout(poll,90)}};if(voiceChannel&&!muted&&!voiceServerMuted)void poll();else setMicLevel(0);return()=>{disposed=true;window.clearTimeout(timer)}},[voiceChannel,muted,voiceServerMuted]);
  useEffect(()=>{if(!voiceChannel)return;void electronBridge().mumble.volumes().then(value=>{setInputVolume(value.input);setOutputVolume(value.output)}).catch(()=>{})},[voiceChannel]);
  useEffect(()=>{if(!voiceChannel){setMemberVolumes({});setTalkingMembers({});return}let disposed=false;let timer=0;const poll=async()=>{try{const users=await electronBridge().mumble.users();if(!disposed){setMemberVolumes(current=>{const next={...current};for(const item of users)next[item.username]=item.volume;return next});setTalkingMembers(Object.fromEntries(users.map(item=>[item.username,item.talking])))}}catch{}finally{if(!disposed)timer=window.setTimeout(poll,220)}};void poll();return()=>{disposed=true;window.clearTimeout(timer)}},[voiceChannel]);
  useEffect(()=>{if(!spaceId||!user)return;request<SpaceMember[]>('space:members',{spaceId}).then(setSpaceMembers).catch(showError)},[spaceId,user,reconnectEpoch]);
  useEffect(()=>{
    const joined=(event:{spaceId:string;user:User})=>{if(event.spaceId===spaceId)setSpaceMembers(all=>all.some(member=>member.id===event.user.id)?all:[...all,{...event.user,role:'member',textMuted:false,voiceMuted:false}])};
    const moderation=(event:{spaceId:string;userId:string;textMuted:boolean;voiceMuted:boolean})=>{
      if(event.spaceId===spaceId)setSpaceMembers(all=>all.map(member=>member.id===event.userId?{...member,textMuted:event.textMuted,voiceMuted:event.voiceMuted}:member));
      const voiceSpace=spaces.find(space=>space.channels.some(channel=>channel.id===voiceChannel));
      if(event.userId===user?.id&&event.spaceId===voiceSpace?.id){
        setVoiceServerMuted(event.voiceMuted);
        if(event.voiceMuted){void window.echodeck?.mumble.command('MUTE 1');setMuted(true)}
      }
    };
    const removed=(event:{spaceId:string;userId:string})=>{if(event.spaceId===spaceId)setSpaceMembers(all=>all.filter(member=>member.id!==event.userId))};
    const spaceRemoved=(event:{spaceId:string})=>{setSpaces(all=>all.filter(space=>space.id!==event.spaceId));if(event.spaceId===spaceId){setSpaceId('');setChannelId('');setManagementOpen(false)}};
    const forcedLeave=(event:{spaceId?:string;channelId?:string;reason:string})=>{const voiceSpace=spaces.find(space=>space.channels.some(channel=>channel.id===voiceChannel));if(event.channelId&&event.channelId!==voiceChannel)return;if(event.spaceId&&event.spaceId!==voiceSpace?.id)return;voiceJoinEpoch.current++;screen.close();setLocalShare(undefined);void window.echodeck?.mumble.disconnect();setVoiceChannel('');setVoiceServerMuted(false);setMuted(false);setDeafened(false);showError(new Error(event.reason))};
    socket.on('space:memberJoined',joined);socket.on('space:memberModeration',moderation);socket.on('space:moderationChanged',moderation);socket.on('space:memberRemoved',removed);socket.on('space:removed',spaceRemoved);socket.on('voice:forcedLeave',forcedLeave);
    return()=>{socket.off('space:memberJoined',joined);socket.off('space:memberModeration',moderation);socket.off('space:moderationChanged',moderation);socket.off('space:memberRemoved',removed);socket.off('space:removed',spaceRemoved);socket.off('voice:forcedLeave',forcedLeave)};
  },[screen,spaceId,spaces,user?.id,voiceChannel]);
  useEffect(()=>{if(!spaceId||!user)return;request<string[]>('space:presence',{spaceId}).then(setOnlineUserIds).catch(showError);const presence=(event:{spaceId:string;userIds:string[]})=>{if(event.spaceId===spaceId)setOnlineUserIds(event.userIds)};socket.on('space:presence',presence);return()=>{socket.off('space:presence',presence)}},[spaceId,user,reconnectEpoch]);
  useEffect(()=>{const activity=(event:{channelId:string;userId:string;mentionedUserIds?:string[]})=>{if(event.channelId===channelId)return;if(!spaces.some(space=>space.channels.some(channel=>channel.id===event.channelId)))return;setUnreadChannels(current=>({...current,[event.channelId]:Math.min(99,(current[event.channelId]??0)+1)}));if(user&&event.mentionedUserIds?.includes(user.id))setMentionedChannels(current=>({...current,[event.channelId]:true}))};const mention=(event:{channelId:string;message:ChatMessage})=>{if(event.channelId!==channelId)setMentionedChannels(current=>({...current,[event.channelId]:true}));if(document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(`${event.message.username} 在 POIO 中提到了你`,{body:event.message.body.slice(0,120)})};socket.on('chat:activity',activity);socket.on('chat:mention',mention);return()=>{socket.off('chat:activity',activity);socket.off('chat:mention',mention)}},[channelId,spaces,user]);
  useEffect(()=>{
    if(!user)return;
    let disposed=false;
    const refresh=()=>request<DirectConversation[]>('dm:list').then(items=>{
      if(disposed)return;
      setDirectConversations(items);
      setDirectUnread(Object.fromEntries(items.map(item=>[item.user.id,item.unreadCount])));
    }).catch(showError);
    void refresh();
    const incoming=(message:DirectMessage)=>{
      const peerId=message.senderId===user.id?message.recipientId:message.senderId;
      if(peerId===directPeer?.id){
        setDirectMessages(current=>current.some(item=>item.id===message.id)?current:[...current,message].slice(-500));
        if(message.senderId!==user.id)void request('dm:read',{peerId}).then(()=>refresh()).catch(showError);
        setDirectUnread(current=>({...current,[peerId]:0}));
      }else if(message.senderId!==user.id){
        setDirectUnread(current=>({...current,[peerId]:Math.min(99,(current[peerId]??0)+1)}));
        if(document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(`${message.username} 发来私聊`,{body:(message.body||message.attachmentName||'附件').slice(0,120)});
      }
      void refresh();
    };
    socket.on('dm:message',incoming);
    return()=>{disposed=true;socket.off('dm:message',incoming)};
  },[directPeer?.id,reconnectEpoch,user]);
  useEffect(()=>{
    if(!user)return;
    const received=(invitation:GomokuInvitation)=>{
      if(invitation.expiresAt<=Date.now())return;
      window.clearTimeout(gomokuInvitationTimer.current);setGomokuInvitation(invitation);
      gomokuInvitationTimer.current=window.setTimeout(()=>setGomokuInvitation(current=>current?.roomId===invitation.roomId?undefined:current),Math.max(0,invitation.expiresAt-Date.now()));
      if(document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(`${invitation.inviter.username} 邀请你下五子棋`,{body:`每人 ${invitation.wager.toLocaleString('zh-CN')} 积分，点击加入棋局`});
    };
    const closed=({roomId}:{roomId:string})=>setGomokuInvitation(current=>current?.roomId===roomId?undefined:current);
    socket.on('game:gomoku:invited',received);
    socket.on('game:gomoku:closed',closed);
    return()=>{socket.off('game:gomoku:invited',received);socket.off('game:gomoku:closed',closed);window.clearTimeout(gomokuInvitationTimer.current)};
  },[user]);
  useEffect(()=>{
    if(!user)return;
    const received=(invitation:TexasInvitation)=>{if(invitation.expiresAt<=Date.now())return;setTexasInvitation(invitation);if(document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(`${invitation.inviter.username} 邀请你玩德州扑克`,{body:`盲注 ${invitation.smallBlind}/${invitation.smallBlind*2}，带入 ${invitation.buyIn.toLocaleString('zh-CN')} 积分`})};
    const closed=({roomId}:{roomId:string})=>setTexasInvitation(current=>current?.roomId===roomId?undefined:current);
    socket.on('game:texas-holdem:invited',received);socket.on('game:texas-holdem:closed',closed);
    return()=>{socket.off('game:texas-holdem:invited',received);socket.off('game:texas-holdem:closed',closed)};
  },[user]);
  useEffect(()=>{
    window.clearTimeout(texasInvitationTimer.current);
    if(!texasInvitation)return;
    texasInvitationTimer.current=window.setTimeout(()=>setTexasInvitation(current=>current?.roomId===texasInvitation.roomId?undefined:current),Math.max(0,texasInvitation.expiresAt-Date.now()));
    return()=>window.clearTimeout(texasInvitationTimer.current);
  },[texasInvitation?.expiresAt,texasInvitation?.roomId]);
  useEffect(()=>{
    if(!user)return;
    const received=(invitation:PoolInvitation)=>{if(invitation.expiresAt<=Date.now())return;window.clearTimeout(poolInvitationTimer.current);setPoolInvitation(invitation);poolInvitationTimer.current=window.setTimeout(()=>setPoolInvitation(current=>current?.roomId===invitation.roomId?undefined:current),Math.max(0,invitation.expiresAt-Date.now()));if(document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(`${invitation.inviter.username} 邀请你打台球`,{body:`每人 ${invitation.wager.toLocaleString('zh-CN')} 积分，点击加入球桌`})};
    const closed=({roomId}:{roomId:string})=>setPoolInvitation(current=>current?.roomId===roomId?undefined:current);
    socket.on('game:pool:invited',received);socket.on('game:pool:closed',closed);
    return()=>{socket.off('game:pool:invited',received);socket.off('game:pool:closed',closed);window.clearTimeout(poolInvitationTimer.current)};
  },[user]);
  useEffect(()=>{
    if(!directPeer||!user)return;
    let disposed=false;
    setDirectMessages([]);
    Promise.all([
      request<DirectMessage[]>('dm:history',{peerId:directPeer.id}),
      request('dm:read',{peerId:directPeer.id}),
    ]).then(([history])=>{if(!disposed){setDirectMessages(history);setDirectUnread(current=>({...current,[directPeer.id]:0}));setDirectConversations(current=>current.map(item=>item.user.id===directPeer.id?{...item,unreadCount:0}:item))}}).catch(showError);
    return()=>{disposed=true};
  },[directPeer?.id,reconnectEpoch,user]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.ctrlKey&&event.key.toLowerCase()==='k'){event.preventDefault();channelSearchRef.current?.focus()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
  useEffect(()=>{const updater=window.echodeck?.update;if(!updater)return;const receive=(status:AppUpdateStatus)=>{setUpdateStatus(status);if(['available','downloaded'].includes(status.state))setUpdateDialogOpen(true)};void updater.status().then(receive);return updater.onStatus(receive)},[]);
  useEffect(()=>{const tray=window.echodeck?.tray;if(!tray)return;const removeMute=tray.onToggleMute(()=>{if(!voiceChannel||voiceServerMuted)return;const next=!muted;void electronBridge().mumble.command(`MUTE ${next?1:0}`).then(()=>setMuted(next)).catch(showError)});const removeLeave=tray.onLeaveVoice(()=>{if(voiceChannel&&voiceJoinCuesEnabled)void playVoiceLeaveCue(user?.leaveSoundUrl?`${serverUrl}${user.leaveSoundUrl}`:undefined);voiceJoinEpoch.current++;setJoiningVoiceChannel('');screen.close();setLocalShare(current=>{current?.getTracks().forEach(track=>track.stop());return undefined});void request('voice:leave').catch(()=>{});void window.echodeck?.mumble.disconnect();setVoiceChannel('');setVoiceServerMuted(false);setMuted(false);setDeafened(false);setTransmitting(false);setPushToTalkActive(false);setMicLevel(0)});return()=>{removeMute();removeLeave()}},[muted,screen,user?.leaveSoundUrl,voiceChannel,voiceJoinCuesEnabled,voiceServerMuted]);
  useEffect(()=>()=>{if(pendingScreenshot)URL.revokeObjectURL(pendingScreenshot.url)},[pendingScreenshot]);
  const applyAuth=(result:AuthPayload)=>{localStorage.setItem(TOKEN_KEY,result.token);setUser(result.user);setSpaces(result.bootstrap);const remembered=localStorage.getItem(LAST_SPACE_KEY);const s=result.bootstrap.find(space=>space.id===remembered)??result.bootstrap[0];setSpaceId(s?.id??'');setChannelId(s?.channels[0]?.id??'');if(s)localStorage.setItem(LAST_SPACE_KEY,s.id)};
  const loadAudioDevices=async()=>{if(!voiceChannel){setAudioDevices(undefined);return}setSettingsBusy(true);try{setAudioDevices(await electronBridge().mumble.devices())}catch(e){showError(e)}finally{setSettingsBusy(false)}};
  const loadVoiceControls=async()=>{if(!voiceChannel)return;try{const [devices,volumes]=await Promise.all([electronBridge().mumble.devices(),electronBridge().mumble.volumes()]);setAudioDevices(devices);setInputVolume(volumes.input);setOutputVolume(volumes.output)}catch{}};
  if(loading)return <div className="boot"><div className="brand-mark">POIO</div><span>正在连接 POIO...</span></div>;
  if(!user)return <><Auth onAuth={applyAuth} onError={showError} invite={incomingInvite} inviteLoading={incomingInviteLoading}/>{error&&<div className="toast">{error}</div>}</>;

  const openDirectMessage=(peer:User)=>{
    if(peer.id===user.id)return;
    setDirectPeer(peer);
    setDirectUnread(current=>({...current,[peer.id]:0}));
    setMessageSearchOpen(false);
  };
  const sendDirectMessage=async(peerId:string,text:string,file?:File)=>{
    if(file&&file.size>50*1024*1024)throw new Error('文件不能超过 50 MB');
    const token=localStorage.getItem(TOKEN_KEY)??'';
    const attachment=file?await uploadFile(file,token):undefined;
    const message=await request<DirectMessage>('dm:send',{peerId,body:text.trim(),attachment});
    setDirectMessages(current=>current.some(item=>item.id===message.id)?current:[...current,message].slice(-500));
  };
  const selectChannel=(channel:Channel)=>{
    setDirectPeer(undefined);
    setChannelId(channel.id);
    setUnreadChannels(current=>({...current,[channel.id]:0}));
    if(channel.kind!=='voice')return;
    const sameActiveVoice=channel.id===voiceChannel&&['connected','connecting','reconnecting'].includes(mumbleState.state);
    if(channel.id===joiningVoiceChannel||sameActiveVoice)return;
    const epoch=++voiceJoinEpoch.current;
    setJoiningVoiceChannel(channel.id);
    const switchVoice=async()=>{
      if(epoch!==voiceJoinEpoch.current)return;
      try{
        if(voiceChannel&&voiceChannel!==channel.id){
          screen.close();
          setLocalShare(current=>{
            current?.getTracks().forEach(track=>track.stop());
            return undefined;
          });
          setTransmitting(false);
          setPushToTalkActive(false);
          setMicLevel(0);
        }
        const connection=window.echodeck?.platform==='web'
          ?{host:'web',port:0,username:`web_${user.id}`,password:'',channelName:channel.name,voiceMuted:false}
          :await request<{host:string;port:number;username:string;password:string;channelName:string;voiceMuted:boolean}>('voice:credentials',{channelId:channel.id});
        if(epoch!==voiceJoinEpoch.current)return;
        await electronBridge().mumble.connect({...connection,channelId:channel.id});
        if(epoch!==voiceJoinEpoch.current)return;
        const presence=await request<{channelId:string;users:User[];moderation:{voiceMuted:boolean}}>('voice:join',{channelId:channel.id});
        if(epoch!==voiceJoinEpoch.current)return;
        setVoiceMembers(all=>({...all,[channel.id]:presence.users}));
        setVoiceChannel(channel.id);
        setVoiceServerMuted(presence.moderation.voiceMuted);
        setJoiningVoiceChannel('');
        setMuted(presence.moderation.voiceMuted);
        setDeafened(false);
        if(voiceJoinCuesEnabled)void playVoiceJoinCue(user.joinSoundUrl?`${serverUrl}${user.joinSoundUrl}`:undefined);
        try{await screen.join(channel.id)}catch(e){if(epoch===voiceJoinEpoch.current)showError(e)}
      }catch(e){
        if(epoch!==voiceJoinEpoch.current)return;
        setJoiningVoiceChannel('');
        screen.close();
        await electronBridge().mumble.disconnect().catch(()=>{});
        setVoiceChannel('');
        setVoiceServerMuted(false);
        setMuted(false);
        setDeafened(false);
        setTransmitting(false);
        setPushToTalkActive(false);
        setMicLevel(0);
        showError(e);
      }
    };
    voiceSwitchQueue.current=voiceSwitchQueue.current.catch(()=>{}).then(switchVoice);
  };
  const send=async()=>{
    const text=body.trim();const queued=pendingScreenshot;
    if(textMuted){showError(new Error('你已被社区拥有者禁言'));return}
    if(!currentChannel||uploading)return;
    if(editingMessage){
      if(!text&&!editingMessage.attachmentUrl)return;
      try{await request<ChatMessage>('chat:edit',{messageId:editingMessage.id,body:text});restoreDraftAfterEditing();setComposerPreview(false)}catch(e){showError(e)}
      return;
    }
    if(!text&&!queued)return;
    const targetChannel=currentChannel;stickToLatestRef.current=true;setMessageAtBottom(true);if(queued)setUploading(true);
    try{
      const token=localStorage.getItem(TOKEN_KEY)??'';
      const attachment=queued?await uploadFile(queued.file,token):undefined;
      await request('chat:send',{channelId:targetChannel.id,body:text,attachment,replyToId:replyingTo?.id});
      updateComposerBody('');setReplyingTo(undefined);setPendingScreenshot(undefined);setComposerPreview(false);
    }catch(e){showError(e)}finally{if(queued)setUploading(false)}
  };
  const attach=async(file?:File)=>{if(textMuted){showError(new Error('你已被社区拥有者禁言'));return}if(editingMessage){showError(new Error('编辑消息时不能更换附件'));return}if(!file||!currentChannel||uploading)return;if(file.size>50*1024*1024){showError(new Error('文件不能超过 50 MB'));return}const targetChannel=currentChannel;setUploading(true);try{const token=localStorage.getItem(TOKEN_KEY)??'';const attachment=await uploadFile(file,token);await request('chat:send',{channelId:targetChannel.id,body:'',attachment,replyToId:replyingTo?.id});setReplyingTo(undefined)}catch(e){showError(e)}finally{setUploading(false);if(fileRef.current)fileRef.current.value=''}};
  const beginEditMessage=(message:ChatMessage)=>{editDraftBackup.current=body;setEditingMessage(message);setReplyingTo(undefined);setBody(message.body);setComposerPreview(false);window.setTimeout(()=>composerInputRef.current?.focus(),0)};
  const deleteChatMessage=async(message:ChatMessage)=>{if(!window.confirm(message.userId===user.id?'确定撤回这条消息吗？':'确定以社区拥有者身份删除这条消息吗？'))return;try{await request('chat:delete',{messageId:message.id});if(editingMessage?.id===message.id)restoreDraftAfterEditing()}catch(e){showError(e)}};
  const reactToMessage=async(message:ChatMessage,emoji:string)=>{try{await request('chat:react',{messageId:message.id,emoji});setReactionMessageId('')}catch(e){showError(e)}};
  const searchChannelMessages=async()=>{const query=messageSearchQuery.trim();if(!query||!currentChannel)return;setMessageSearchBusy(true);try{setMessageSearchResults(await request<ChatMessage[]>('chat:search',{channelId:currentChannel.id,query}))}catch(e){showError(e)}finally{setMessageSearchBusy(false)}};
  const jumpToMessage=(message:ChatMessage)=>{setMessageSearchOpen(false);window.setTimeout(()=>{const element=document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(message.id)}"]`);element?.scrollIntoView({behavior:'smooth',block:'center'});element?.classList.add('message-highlight');window.setTimeout(()=>element?.classList.remove('message-highlight'),1800)},0)};
  const captureScreenshot=async()=>{try{const bridge=window.echodeck;if(!bridge?.captureScreenshot)throw new Error('当前客户端不支持截图，请更新后重试');setEmojiOpen(false);setScreenshot(await bridge.captureScreenshot())}catch(e){showError(e)}};
  const queueScreenshot=(file:File)=>{setPendingScreenshot({file,url:URL.createObjectURL(file)});setScreenshot(undefined);setComposerPreview(false);window.setTimeout(()=>composerInputRef.current?.focus(),0)};
  const insertMarkdown=(before:string,after=before,placeholder='文字')=>{const input=composerInputRef.current;if(!input)return;const start=input.selectionStart;const end=input.selectionEnd;const selected=body.slice(start,end)||placeholder;const next=`${body.slice(0,start)}${before}${selected}${after}${body.slice(end)}`;updateComposerBody(next);window.setTimeout(()=>{input.focus();input.setSelectionRange(start+before.length,start+before.length+selected.length)},0)};
  const prefixMarkdown=(prefix:string)=>{const input=composerInputRef.current;if(!input)return;const start=input.selectionStart;const end=input.selectionEnd;const selected=body.slice(start,end)||'文字';const replacement=selected.split('\n').map(line=>`${prefix}${line}`).join('\n');updateComposerBody(`${body.slice(0,start)}${replacement}${body.slice(end)}`);window.setTimeout(()=>{input.focus();input.setSelectionRange(start,start+replacement.length)},0)};
  const updateAvatarFromFile=async(file?:File)=>{if(!file||avatarUploading)return;if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){showError(new Error('头像仅支持 PNG、JPG、GIF 或 WebP'));return}if(file.size>8*1024*1024){showError(new Error('头像不能超过 8 MB'));return}setAvatarUploading(true);try{const token=localStorage.getItem(TOKEN_KEY)??'';const uploaded=await uploadFile(file,token);const updated=await request<User>('user:avatar',{url:uploaded.url});setUser(updated);setAccountOpen(false)}catch(e){showError(e)}finally{setAvatarUploading(false);if(avatarRef.current)avatarRef.current.value=''}};
  const updateJoinSoundFromFile=async(file?:File)=>{if(!file||joinSoundBusy)return;setJoinSoundBusy(true);try{await validateJoinSound(file);const token=localStorage.getItem(TOKEN_KEY)??'';const uploaded=await uploadFile(file,token);const updated=await request<User>('user:joinSound',{url:uploaded.url});setUser(updated);void playVoiceJoinCue(`${serverUrl}${updated.joinSoundUrl}`)}catch(e){showError(e)}finally{setJoinSoundBusy(false)}};
  const removeJoinSound=async()=>{if(joinSoundBusy)return;setJoinSoundBusy(true);try{setUser(await request<User>('user:joinSound',{url:null}));void playVoiceJoinCue()}catch(e){showError(e)}finally{setJoinSoundBusy(false)}};
  const updateLeaveSoundFromFile=async(file?:File)=>{if(!file||leaveSoundBusy)return;setLeaveSoundBusy(true);try{await validateLeaveSound(file);const token=localStorage.getItem(TOKEN_KEY)??'';const uploaded=await uploadFile(file,token);const updated=await request<User>('user:leaveSound',{url:uploaded.url});setUser(updated);void playVoiceLeaveCue(`${serverUrl}${updated.leaveSoundUrl}`)}catch(e){showError(e)}finally{setLeaveSoundBusy(false)}};
  const removeLeaveSound=async()=>{if(leaveSoundBusy)return;setLeaveSoundBusy(true);try{setUser(await request<User>('user:leaveSound',{url:null}));void playVoiceLeaveCue()}catch(e){showError(e)}finally{setLeaveSoundBusy(false)}};
  const toggleVoiceJoinCues=(enabled:boolean)=>{setVoiceJoinCuesEnabled(enabled);localStorage.setItem(VOICE_JOIN_CUES_KEY,enabled?'1':'0')};
  const addChannel=async(name:string,kind:'text'|'voice')=>{if(!currentSpace)return;try{const c=await request<Channel>('channel:create',{spaceId:currentSpace.id,name,kind});setChannelId(c.id);setChannelDialog(undefined)}catch(e){showError(e)}};
  const openInvite=async()=>{if(!currentSpace)return;try{setInvite(await request<SpaceInvite>('space:invite',{spaceId:currentSpace.id}))}catch(e){showError(e)}};
  const createSpaceFromDialog=async(name:string)=>{try{const space=await request<Space>('space:create',{name});setSpaces(all=>[...all,space]);setSpaceId(space.id);setChannelId(space.channels[0]?.id??'');localStorage.setItem(LAST_SPACE_KEY,space.id);setSpaceDialog(undefined)}catch(e){showError(e)}};
  const joinSpaceFromDialog=async(code:string)=>{try{const space=await request<Space>('space:join',{code});setSpaces(all=>all.some(item=>item.id===space.id)?all:[...all,space]);setSpaceId(space.id);setChannelId(space.channels[0]?.id??'');localStorage.setItem(LAST_SPACE_KEY,space.id);setSpaceDialog(undefined)}catch(e){showError(e)}};
  const acceptIncomingInvite=async()=>{if(!incomingInvite||incomingInviteJoining)return;setIncomingInviteJoining(true);try{const existing=spaces.find(space=>space.id===incomingInvite.spaceId);const space=existing??await request<Space>('space:join',{code:incomingInvite.code});setSpaces(all=>all.some(item=>item.id===space.id)?all:[...all,space]);setSpaceId(space.id);setChannelId(space.channels[0]?.id??'');localStorage.setItem(LAST_SPACE_KEY,space.id);localStorage.removeItem(PENDING_INVITE_KEY);setIncomingInvite(undefined)}catch(e){showError(e)}finally{setIncomingInviteJoining(false)}};
  const openGameInvitation=(gameId:'gomoku'|'texas-holdem'|'pool',spaceId:string,roomId:string)=>{const space=spaces.find(item=>item.id===spaceId);if(!space){showError(new Error('你已不在这个社区中'));return}setSpaceId(space.id);setChannelId(space.channels[0]?.id??'');localStorage.setItem(LAST_SPACE_KEY,space.id);setPendingGameJoin({gameId,roomId});setGameOpen(true);setAccountOpen(false);setDirectPeer(undefined)};
  const openGomokuInvitation=(spaceId:string,roomId:string)=>openGameInvitation('gomoku',spaceId,roomId);
  const acceptGomokuInvitation=()=>{if(!gomokuInvitation)return;openGomokuInvitation(gomokuInvitation.spaceId,gomokuInvitation.roomId);setGomokuInvitation(undefined)};
  const acceptTexasInvitation=()=>{if(!texasInvitation)return;openGameInvitation('texas-holdem',texasInvitation.spaceId,texasInvitation.roomId);setTexasInvitation(undefined)};
  const acceptPoolInvitation=()=>{if(!poolInvitation)return;openGameInvitation('pool',poolInvitation.spaceId,poolInvitation.roomId);setPoolInvitation(undefined)};
  const loadShareSources=async(epoch:number)=>{setShareSourcesLoading(true);setShareSourcesError('');try{const bridge=window.echodeck;if(!bridge)throw new Error('桌面共享组件尚未加载');const next=await bridge.getDesktopSources();if(epoch!==shareSourceEpoch.current)return;setSources(next)}catch(e){if(epoch!==shareSourceEpoch.current)return;const message=e instanceof Error?e.message:'无法读取可共享的窗口';setShareSourcesError(message);showError(e)}finally{if(epoch===shareSourceEpoch.current)setShareSourcesLoading(false)}};
  const openShare=()=>{if(!voiceChannel){showError(new Error('请先加入语音频道'));return}const epoch=++shareSourceEpoch.current;setShareOpen(true);setShareSourcesError('');if(sources.length===0)setShareSourcesLoading(true);window.setTimeout(()=>void loadShareSources(epoch),0)};
  const closeShare=()=>{shareSourceEpoch.current++;setShareOpen(false);setShareSourcesLoading(false);setShareSourcesError('')};
  const startShare=async(sourceId:string,nativeSourceId?:string)=>{try{if(!voiceChannel)throw new Error('请先加入语音频道');await screen.join(voiceChannel);const stream=await screen.share(sourceId,shareProfile,shareAudio,nativeSourceId);stream?.getVideoTracks()[0]?.addEventListener('ended',()=>setLocalShare(current=>current===stream?undefined:current));setLocalShare(stream);setShareOpen(false)}catch(e){showError(e)}};
  const leaveVoiceChannel=async()=>{if(voiceChannel&&voiceJoinCuesEnabled)void playVoiceLeaveCue(user.leaveSoundUrl?`${serverUrl}${user.leaveSoundUrl}`:undefined);voiceJoinEpoch.current++;setJoiningVoiceChannel('');screen.close();localShare?.getTracks().forEach(track=>track.stop());setLocalShare(undefined);try{await request('voice:leave')}catch{}finally{await electronBridge().mumble.disconnect();setVoiceChannel('');setVoiceServerMuted(false);setMuted(false);setDeafened(false);setTransmitting(false);setPushToTalkActive(false);setMicLevel(0)}};
  const logout=async()=>{screen.close();localShare?.getTracks().forEach(track=>track.stop());try{await request('voice:leave')}catch{}try{await window.echodeck?.mumble.disconnect()}catch{}const token=localStorage.getItem(TOKEN_KEY);try{if(token)await request('auth:logout',{token})}catch{}finally{localStorage.removeItem(TOKEN_KEY);window.location.reload()}};
  const changeVolume=(kind:'input'|'output',value:number)=>{if(kind==='input')setInputVolume(value);else setOutputVolume(value);window.clearTimeout(volumeTimer.current);volumeTimer.current=window.setTimeout(()=>{void electronBridge().mumble.setVolume(kind,value).then(volumes=>{setInputVolume(volumes.input);setOutputVolume(volumes.output)}).catch(showError)},100)};
  const changeMemberVolume=(member:User,value:number)=>{const username=`ed_${member.id}`;setMemberVolumes(current=>({...current,[username]:value}));window.clearTimeout(memberVolumeTimers.current[username]);memberVolumeTimers.current[username]=window.setTimeout(()=>{void electronBridge().mumble.setUserVolume(username,value).then(saved=>setMemberVolumes(current=>({...current,[username]:saved}))).catch(showError)},100)};
  const selectQuickDevice=async(kind:'input'|'output',index:number)=>{try{const mumble=electronBridge().mumble;setAudioDevices(kind==='input'?await mumble.setInput(index):await mumble.setOutput(index))}catch(e){showError(e)}};
  const updateReady=updateStatus.state==='downloaded';
  const openOrCheckUpdate=()=>{if(['available','downloading','downloaded','error'].includes(updateStatus.state))setUpdateDialogOpen(true);else void window.echodeck?.update.check()};
  const titleUpdateVisible=['available','downloading','downloaded','error'].includes(updateStatus.state);
  const titleUpdateText=updateStatus.state==='available'?`发现 ${updateStatus.version??'新版本'}`:updateStatus.state==='downloading'?`更新下载中 ${updateStatus.percent??0}%`:updateStatus.state==='downloaded'?`${updateStatus.version??'新版本'} 已就绪`:'更新失败，点击重试';

  return <div className={`app-shell ${membersOpen?'':'members-hidden'} ${window.echodeck?.os==='darwin'?'macos':''}`}>
    <header className="titlebar"><div className="title-brand"><div className="poio-wordmark" aria-label="POIO">POIO</div></div><div className="drag-region"/>{titleUpdateVisible&&<button className={`title-update ${updateReady?'ready':updateStatus.state==='error'?'failed':''}`} onClick={openOrCheckUpdate}><Download size={13}/><span>{titleUpdateText}</span>{updateReady&&<b>安装</b>}</button>}<button onClick={()=>window.echodeck?.window.minimize()}><Minus size={15}/></button><button onClick={()=>window.echodeck?.window.maximize()}><Square size={12}/></button><button className="close" onClick={()=>window.echodeck?.window.close()}><X size={16}/></button></header>
    <aside className="space-rail"><button className={`home ${gameOpen?'':'active'}`} title="POIO" onClick={()=>setGameOpen(false)}><div className="mini-mark">P</div>{Object.values(directUnread).some(count=>count>0)&&<i className="space-unread"/>}</button><button className={`game-rail ${gameOpen?'active':''}`} title="POIO 游戏中心" onClick={()=>{setGameOpen(true);setAccountOpen(false)}}><Gamepad2/></button><div className="rail-sep"/>{spaces.map(s=><button key={s.id} title={s.name} className={!gameOpen&&s.id===currentSpace?.id?'space active':'space'} onClick={()=>{const first=s.channels[0]?.id??'';setGameOpen(false);setDirectPeer(undefined);setSpaceId(s.id);setChannelId(first);setUnreadChannels(current=>({...current,[first]:0}));setChannelQuery('');localStorage.setItem(LAST_SPACE_KEY,s.id)}}>{spaceInitial(s.name)}{s.channels.some(channel=>(unreadChannels[channel.id]??0)>0)&&<i className="space-unread"/>}<span>{s.name}</span></button>)}<button className="add-space" title="创建或加入社区" onClick={()=>setSpaceDialog('join')}><Plus/></button></aside>
    <aside className="channel-panel"><div className="space-head"><strong>{currentSpace?.name}</strong><span>{isSpaceOwner&&<button title="社区与频道管理" onClick={()=>setManagementOpen(true)}><Shield size={16}/></button>}{isSpaceOwner&&<button title="邀请好友" onClick={()=>void openInvite()}><UserPlus size={16}/></button>}</span></div><div className="channel-search"><Search size={15}/><input ref={channelSearchRef} value={channelQuery} onChange={event=>setChannelQuery(event.target.value)} placeholder="搜索频道"/><kbd>Ctrl K</kbd></div>
      <div className="channels">{directConversations.length>0&&<ChannelGroup title="私信">{directConversations.filter(item=>spaceMembers.some(member=>member.id===item.user.id)).map(item=><DirectConversationItem key={item.user.id} item={item} active={directPeer?.id===item.user.id} unread={directUnread[item.user.id]??item.unreadCount} onClick={()=>openDirectMessage(item.user)}/>)}</ChannelGroup>}<ChannelGroup title="文字频道" onAdd={isSpaceOwner?()=>setChannelDialog('text'):undefined}>{currentSpace?.channels.filter(c=>c.kind==='text'&&c.name.toLowerCase().includes(channelQuery.trim().toLowerCase())).map(c=><ChannelItem key={c.id} channel={c} active={!directPeer&&c.id===channelId} voice={false} joining={false} unread={unreadChannels[c.id]??0} mentioned={mentionedChannels[c.id]===true} onClick={()=>selectChannel(c)}/>)}</ChannelGroup><ChannelGroup title="语音频道" onAdd={isSpaceOwner?()=>setChannelDialog('voice'):undefined}>{currentSpace?.channels.filter(c=>c.kind==='voice'&&c.name.toLowerCase().includes(channelQuery.trim().toLowerCase())).map(c=><div className="voice-channel-entry" key={c.id}><ChannelItem channel={c} active={!directPeer&&c.id===channelId} voice={c.id===voiceChannel} joining={c.id===joiningVoiceChannel} unread={unreadChannels[c.id]??0} mentioned={mentionedChannels[c.id]===true} onClick={()=>selectChannel(c)}/>{(voiceMembers[c.id]??[]).map(member=><VoiceMember key={member.id} user={member} self={member.id===user.id} connected={c.id===voiceChannel} talking={member.id===user.id?transmitting:talkingMembers[`ed_${member.id}`]===true} volume={memberVolumes[`ed_${member.id}`]??100} onVolume={value=>changeMemberVolume(member,value)}/>)}</div>)}</ChannelGroup></div>
      <div className={`voice-status ${mumbleState.state==='reconnecting'||mumbleState.state==='connecting'?'reconnecting':''} ${transmitting?'transmitting':''}`}>{voiceChannel?<><div className="signal"><i/><i/><i/></div><div><b>{transmitting?'正在通过 Mumble 发送语音':mumbleState.state==='reconnecting'?'Mumble 原生语音正在重连':mumbleState.state==='connecting'?'Mumble 原生语音正在连接':mumbleState.state==='error'?'Mumble 原生语音等待恢复':'Mumble 原生语音已连接'}</b><span>{pushToTalkActive&&!transmitting?'按键说话已按下 · ':mumbleState.state==='reconnecting'&&mumbleState.attempt?`第 ${mumbleState.attempt} 次尝试 · `:''}{currentSpace?.channels.find(c=>c.id===voiceChannel)?.name}</span></div><button onClick={()=>void leaveVoiceChannel()}><X size={17}/></button></>:<><Headphones size={19}/><span>尚未加入语音频道</span></>}</div>
      <div className="user-bar"><input ref={avatarRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event=>void updateAvatarFromFile(event.target.files?.[0])}/><div className="account-menu-wrap"><button className="account-trigger" title="账号菜单" onClick={()=>setAccountOpen(value=>!value)}><Avatar name={user.username} avatarUrl={user.avatarUrl}/><div className="user-identity"><b>{user.username}</b><span>{transmitting?'正在说话':voiceChannel?'语音已连接':'在线'}</span></div></button>{accountOpen&&<div className="account-popover"><div className="account-summary"><Avatar name={user.username} avatarUrl={user.avatarUrl}/><span><b>{user.username}</b><small>POIO 账号</small></span></div><button className="change-avatar-button" disabled={avatarUploading} onClick={()=>avatarRef.current?.click()}><Image size={15}/>{avatarUploading?'正在上传头像…':'更换头像（支持动态）'}</button><div className={`account-update ${updateReady?'ready':''}`}><Download size={15}/><span><b>客户端更新</b><small>{updateStatusText(updateStatus)}</small></span><button disabled={updateStatus.state==='checking'} onClick={openOrCheckUpdate}>{updateReady?'查看更新':updateStatus.state==='available'?'立即更新':updateStatus.state==='downloading'?`${updateStatus.percent??0}%`:updateStatus.state==='checking'?'检查中':'检查更新'}</button></div><button className="logout-button" onClick={()=>void logout()}><LogOut size={15}/>退出登录</button></div>}</div><div className="voice-control-wrap" onMouseEnter={()=>void loadVoiceControls()}><button disabled={!voiceChannel||voiceServerMuted} className={`mic-control ${muted||voiceServerMuted?'muted':transmitting?'speaking':pushToTalkActive?'ptt-active':''}`} title={voiceServerMuted?'你已被社区拥有者关闭麦克风':muted?'取消静音':transmitting?'正在发送语音':pushToTalkActive?'按键说话已按下':'麦克风'} style={{boxShadow:muted||voiceServerMuted||!transmitting?'none':`0 0 0 ${Math.round(micLevel*7)}px rgba(69,221,195,${Math.max(.08,micLevel*.45)})`}} onClick={async()=>{if(voiceServerMuted)return;const next=!muted;try{await window.echodeck?.mumble.command(`MUTE ${next?1:0}`);setMuted(next)}catch(e){showError(e)}}}>{muted||voiceServerMuted?<MicOff size={18}/>:<Mic size={18}/>}<i className="mic-mini-level" style={{height:`${Math.max(3,Math.round(micLevel*22))}px`}}/></button>{voiceChannel&&<AudioControlPopover kind="input" volume={inputVolume} devices={audioDevices?.inputs??[]} onVolume={value=>changeVolume('input',value)} onDevice={index=>void selectQuickDevice('input',index)} onSettings={()=>{setSettingsOpen(true);void loadAudioDevices()}}/>}</div><div className="voice-control-wrap output-control" onMouseEnter={()=>void loadVoiceControls()}><button disabled={!voiceChannel} className={deafened?'deafened':''} title={deafened?'打开接收声音':'关闭接收声音（同时关闭麦克风）'} onClick={async()=>{const next=!deafened;try{await window.echodeck?.mumble.command(`DEAF ${next?1:0}`);setDeafened(next)}catch(e){showError(e)}}}>{deafened?<HeadphoneOff size={18}/>:<Headphones size={18}/>}</button>{voiceChannel&&<AudioControlPopover kind="output" volume={outputVolume} devices={audioDevices?.outputs??[]} onVolume={value=>changeVolume('output',value)} onDevice={index=>void selectQuickDevice('output',index)} onSettings={()=>{setSettingsOpen(true);void loadAudioDevices()}}/>}</div><button className="hangup" disabled={!voiceChannel} title="挂断语音" onClick={()=>void leaveVoiceChannel()}><PhoneOff size={17}/></button><button title="设置" onClick={()=>{setSettingsOpen(true);void loadAudioDevices()}}><Settings size={18}/></button></div>
    </aside>
    <main className="content">{directPeer?<DirectMessageView peer={directPeer} currentUser={user} messages={directMessages} onSend={(text,file)=>sendDirectMessage(directPeer.id,text,file)} onJoinGame={openGameInvitation} onError={showError} onClose={()=>setDirectPeer(undefined)} onPreview={(url,name)=>setImagePreview({url,name})}/>:<><div className="channel-head"><div>{channelIcon(currentChannel?.kind??'text')}<strong>{currentChannel?.name}</strong><span>{currentChannel?.kind==='voice'?'语音频道 · 可聊天与共享屏幕':'文字频道'}</span></div><div className="head-actions"><button onClick={openShare} className="share"><MonitorUp size={18}/>共享屏幕</button><button className={messageSearchOpen?'active':''} title="搜索当前频道消息" onClick={()=>{setMessageSearchOpen(value=>!value);setMessageSearchResults([]);window.setTimeout(()=>document.querySelector<HTMLInputElement>('.message-search input')?.focus(),0)}}><Search size={18}/></button><button className={membersOpen?'active':''} title={membersOpen?'隐藏成员列表':'显示成员列表'} onClick={()=>setMembersOpen(value=>!value)}><Users size={19}/></button></div></div>
      {messageSearchOpen&&<div className="message-search"><div className="message-search-box"><Search size={16}/><input value={messageSearchQuery} maxLength={100} onChange={event=>setMessageSearchQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void searchChannelMessages()}} placeholder={`搜索 #${currentChannel?.name??''} 中的消息`}/><button disabled={!messageSearchQuery.trim()||messageSearchBusy} onClick={()=>void searchChannelMessages()}>{messageSearchBusy?'搜索中':'搜索'}</button><button title="关闭搜索" onClick={()=>setMessageSearchOpen(false)}><X size={15}/></button></div>{messageSearchResults.length>0&&<div className="message-search-results">{messageSearchResults.map(message=><button key={message.id} onClick={()=>jumpToMessage(message)}><Avatar name={message.username} avatarUrl={message.avatarUrl}/><span><b>{message.username}<time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time></b><small>{message.body||message.attachmentName||'附件'}</small></span></button>)}</div>}{!messageSearchBusy&&messageSearchQuery.trim()&&messageSearchResults.length===0&&<div className="message-search-empty">输入关键词后按 Enter 搜索</div>}</div>}
      {(localShare||screenShareStatus.sharing||screenShareStatus.connecting||remoteMedia.some(m=>m.tag==='screen'))&&<MediaStage local={localShare} localActive={screenShareStatus.sharing||screenShareStatus.connecting} remote={remoteMedia} members={spaceMembers} shareStatus={screenShareStatus} onStop={async()=>{await screen.stopShare();localShare?.getTracks().forEach(t=>t.stop());setLocalShare(undefined)}}/>}
      <div ref={messageListRef} className="message-list" onScroll={event=>{const list=event.currentTarget;const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<72;stickToLatestRef.current=atBottom;setMessageAtBottom(atBottom)}}><div ref={messageFeedRef} className="message-feed"><div className="welcome"><div>{channelIcon(currentChannel?.kind??'text')}</div><h2>欢迎来到 {currentChannel?.name}</h2><p>{currentChannel?.kind==='voice'?'在这里说话、发消息，或者以 1080p / 原画共享你的屏幕。':'这是该频道的起点。开始一段新的对话吧。'}</p></div>{messages.map((m,i)=><Message key={m.id} message={m} compact={!m.deleted&&messages[i-1]?.userId===m.userId&&m.createdAt-messages[i-1].createdAt<300000} currentUserId={user.id} canModerate={isSpaceOwner===true} reactionOpen={reactionMessageId===m.id} onToggleReactionPicker={()=>setReactionMessageId(current=>current===m.id?'':m.id)} onReact={emoji=>void reactToMessage(m,emoji)} onReply={()=>{setReplyingTo(m);setEditingMessage(undefined);window.setTimeout(()=>composerInputRef.current?.focus(),0)}} onEdit={()=>beginEditMessage(m)} onDelete={()=>void deleteChatMessage(m)} onPreview={(url,name)=>setImagePreview({url,name})}/>)}</div></div>
      {!messageAtBottom&&<button className="message-jump-latest" onClick={()=>{const list=messageListRef.current;if(!list)return;stickToLatestRef.current=true;list.scrollTo({top:list.scrollHeight,behavior:'smooth'});setMessageAtBottom(true)}}><ChevronDown size={15}/>回到最新消息</button>}
      <div className={`composer ${composerExpanded?'expanded':''} ${composerPreview?'previewing':''} ${dropActive?'drop-active':''}`} onDragEnter={event=>{event.preventDefault();setDropActive(true)}} onDragOver={event=>event.preventDefault()} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropActive(false)}} onDrop={event=>{event.preventDefault();setDropActive(false);void attach(event.dataTransfer.files?.[0])}}>
        <input ref={fileRef} hidden type="file" onChange={e=>void attach(e.target.files?.[0])}/>
        {(replyingTo||editingMessage)&&<div className={`composer-context ${editingMessage?'editing':''}`}>{editingMessage?<Pencil size={15}/>:<Quote size={15}/>}<span><b>{editingMessage?'编辑消息':`回复 ${replyingTo?.username}`}</b><small>{editingMessage?.body||replyingTo?.body||replyingTo?.attachmentName||'已撤回的消息'}</small></span><button title="取消" onClick={()=>{if(editingMessage)restoreDraftAfterEditing();else setReplyingTo(undefined)}}><X size={15}/></button></div>}
        {composerExpanded&&<div className="composer-toolbar"><button title="粗体" onClick={()=>insertMarkdown('**')}><b>B</b></button><button title="斜体" onClick={()=>insertMarkdown('*')}><i>I</i></button><button title="删除线" onClick={()=>insertMarkdown('~~')}><Strikethrough size={16}/></button><span/><button title="插入链接" onClick={()=>insertMarkdown('[','](https://)','链接文字')}><Link2 size={16}/></button><button title="引用" onClick={()=>prefixMarkdown('> ')}><Quote size={16}/></button><button title="行内代码或代码块" onClick={()=>{const selected=body.slice(composerInputRef.current?.selectionStart??0,composerInputRef.current?.selectionEnd??0);insertMarkdown(selected.includes('\n')?'```\n':'`',selected.includes('\n')?'\n```':'`','代码')}}><Code2 size={16}/></button><button className={composerPreview?'active':''} title={composerPreview?'返回编辑':'预览 Markdown'} onClick={()=>setComposerPreview(value=>!value)}><Eye size={16}/></button></div>}
        {pendingScreenshot&&<div className="composer-pending"><img src={pendingScreenshot.url}/><span><b>{pendingScreenshot.file.name}</b><small>{formatBytes(pendingScreenshot.file.size)} · 等待发送</small></span><button title="移除截图" onClick={()=>setPendingScreenshot(undefined)}><X size={15}/></button></div>}
        <button className="composer-attach" disabled={uploading||textMuted||!!editingMessage} onClick={()=>fileRef.current?.click()} title={editingMessage?'编辑消息时不能更换附件':'发送图片或文件'}>{uploading?<span className="upload-spinner"/>:<CirclePlus size={21}/>}</button>
        {composerPreview?<MarkdownContent body={body||'*没有可预览的内容*'} className="composer-markdown-preview"/>:<textarea ref={composerInputRef} disabled={textMuted} maxLength={4000} value={body} onChange={e=>updateComposerBody(e.target.value)} onPaste={event=>{const file=event.clipboardData.files?.[0];if(file){event.preventDefault();void attach(file)}}} onKeyDown={e=>{if(e.key==='Escape'&&(replyingTo||editingMessage)){if(editingMessage)restoreDraftAfterEditing();else setReplyingTo(undefined)}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={textMuted?'你已被社区拥有者禁言':editingMessage?'编辑消息内容':uploading?'正在上传附件…':`发送消息到 #${currentChannel?.name??''}`}/>}
        <button disabled={textMuted} className={emojiOpen?'active':''} title="选择表情" onClick={()=>setEmojiOpen(value=>!value)}><Smile size={20}/></button>
        <button disabled={textMuted} title="区域截图" onClick={()=>void captureScreenshot()}><Scissors size={19}/></button>
        <button title={composerExpanded?'收起编辑器':'展开编辑器'} onClick={()=>{setComposerExpanded(value=>!value);setComposerPreview(false)}}>{composerExpanded?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button>
        {(composerExpanded||pendingScreenshot||editingMessage||replyingTo)&&<button className="composer-send" disabled={uploading||(!body.trim()&&!pendingScreenshot&&!(editingMessage?.attachmentUrl))} onClick={()=>void send()}>{editingMessage?<Save size={16}/>:<Send size={16}/>}<span>{editingMessage?'保存':'发送'}</span></button>}
        {emojiOpen&&<EmojiPicker onPick={emoji=>{updateComposerBody(body+emoji);setEmojiOpen(false)}}/>}{dropActive&&<div className="composer-drop"><Image/><b>松开发送文件</b><span>支持图片和最大 50 MB 的文件</span></div>}
      </div></>}
    </main>
    <aside className="member-panel">{currentChannel?.kind==='voice'?<><div className="member-title">频道成员 — {visibleVoiceMembers.length}</div>{visibleVoiceMembers.map(member=><MemberRow key={member.id} member={member} online status={`已进入 ${currentChannel.name}`} self={member.id===user.id} unread={directUnread[member.id]??0} onMessage={()=>openDirectMessage(member)}/>)}</>:<><div className="member-title">在线 — {onlineMembers.length}</div>{onlineMembers.map(member=><MemberRow key={member.id} member={member} online status={member.role==='owner'?'社区拥有者':'在线'} self={member.id===user.id} unread={directUnread[member.id]??0} onMessage={()=>openDirectMessage(member)}/>)}<div className="member-title muted">离线 — {offlineMembers.length}</div>{offlineMembers.map(member=><MemberRow key={member.id} member={member} status={member.role==='owner'?'社区拥有者':'离线'} self={member.id===user.id} unread={directUnread[member.id]??0} onMessage={()=>openDirectMessage(member)}/>)}</>}{isSpaceOwner&&<button className="invite-member" onClick={()=>void openInvite()}><UserPlus size={15}/>邀请好友加入</button>}</aside>
    {gameOpen&&currentSpace&&<GameCenter spaceId={currentSpace.id} spaceName={currentSpace.name} onlineMembers={onlineMembers} joinRoom={pendingGameJoin} onJoinRoomHandled={()=>setPendingGameJoin(undefined)} onClose={()=>setGameOpen(false)} onError={showError}/>}
    {spaceDialog&&<SpaceDialog initialMode={spaceDialog} onCreate={createSpaceFromDialog} onJoin={joinSpaceFromDialog} onClose={()=>setSpaceDialog(undefined)}/>} {channelDialog&&<ChannelDialog kind={channelDialog} onCreate={addChannel} onClose={()=>setChannelDialog(undefined)}/>} {invite&&<InviteDialog invite={invite} onClose={()=>setInvite(undefined)}/>} {managementOpen&&currentSpace&&isSpaceOwner&&<CommunityManagement space={currentSpace} members={spaceMembers} onError={showError} onClose={()=>setManagementOpen(false)}/>} {incomingInvite&&<IncomingInviteDialog invite={incomingInvite} alreadyJoined={spaces.some(space=>space.id===incomingInvite.spaceId)} busy={incomingInviteJoining} onAccept={()=>void acceptIncomingInvite()} onClose={()=>{localStorage.removeItem(PENDING_INVITE_KEY);setIncomingInvite(undefined)}}/>} {imagePreview&&<ImagePreview url={imagePreview.url} name={imagePreview.name} onClose={()=>setImagePreview(undefined)}/>} {screenshot&&<ScreenshotSelector capture={screenshot} onConfirm={queueScreenshot} onClose={()=>setScreenshot(undefined)}/>}
    {shareOpen&&<SharePicker sources={sources} loading={shareSourcesLoading} error={shareSourcesError} profile={shareProfile} setProfile={setShareProfile} includeAudio={shareAudio} setIncludeAudio={setShareAudio} onPick={startShare} onRetry={()=>{const epoch=++shareSourceEpoch.current;void loadShareSources(epoch)}} onClose={closeShare}/>}
    {settingsOpen&&<AudioSettings connected={!!voiceChannel} devices={audioDevices} busy={settingsBusy} micLevel={muted?0:micLevel} joinSoundBusy={joinSoundBusy} joinSoundUrl={user.joinSoundUrl} leaveSoundBusy={leaveSoundBusy} leaveSoundUrl={user.leaveSoundUrl} voiceJoinCuesEnabled={voiceJoinCuesEnabled} onToggleVoiceJoinCues={toggleVoiceJoinCues} onUploadJoinSound={updateJoinSoundFromFile} onRemoveJoinSound={removeJoinSound} onTestJoinSound={()=>void playVoiceJoinCue(user.joinSoundUrl?`${serverUrl}${user.joinSoundUrl}`:undefined)} onUploadLeaveSound={updateLeaveSoundFromFile} onRemoveLeaveSound={removeLeaveSound} onTestLeaveSound={()=>void playVoiceLeaveCue(user.leaveSoundUrl?`${serverUrl}${user.leaveSoundUrl}`:undefined)} onRefresh={loadAudioDevices} onSelect={async(kind,index)=>{setSettingsBusy(true);try{const mumble=electronBridge().mumble;setAudioDevices(kind==='input'?await mumble.setInput(index):await mumble.setOutput(index))}catch(e){showError(e)}finally{setSettingsBusy(false)}}} onClose={()=>setSettingsOpen(false)}/>}
    {updateDialogOpen&&<UpdateDialog status={updateStatus} onClose={()=>setUpdateDialogOpen(false)} onDownload={()=>void window.echodeck?.update.download()} onInstall={()=>void window.echodeck?.update.install()} onRetry={()=>void window.echodeck?.update.check()}/>} {error&&<div className="toast">{error}</div>}
    {gomokuInvitation&&<GomokuInvitationCard invitation={gomokuInvitation} onAccept={acceptGomokuInvitation} onClose={()=>setGomokuInvitation(undefined)}/>}
    {texasInvitation&&<TexasInvitationCard invitation={texasInvitation} onAccept={acceptTexasInvitation} onClose={()=>setTexasInvitation(undefined)}/>}
    {poolInvitation&&<PoolInvitationCard invitation={poolInvitation} onAccept={acceptPoolInvitation} onClose={()=>setPoolInvitation(undefined)}/>}
  </div>
}

function Auth({onAuth,onError,invite,inviteLoading}:{onAuth:(v:AuthPayload)=>void;onError:(e:unknown)=>void;invite?:InvitePreview;inviteLoading:boolean}){const[registering,setRegistering]=useState(false);const[username,setUsername]=useState('');const[password,setPassword]=useState('');const[busy,setBusy]=useState(false);const submit=async()=>{setBusy(true);try{onAuth(await request<AuthPayload>(registering?'auth:register':'auth:login',{username,password}))}catch(e){onError(e)}finally{setBusy(false)}};return <div className="auth-page"><div className="aurora a"/><div className="aurora b"/><div className="auth-brand"><div className="brand-mark">POIO</div><h1>POIO</h1><p>一起开黑，清晰沟通，瞬间分享。</p><div className="feature-row"><span><Volume2/>10ms Opus 语音</span><span><MonitorUp/>原画屏幕共享</span><span><Gamepad2/>为游戏而生</span></div></div><div className="auth-card"><h2>{registering?'创建你的账号':'欢迎回来'}</h2><p>{registering?'加入你的第一座语音社区':'登录后继续和朋友一起玩'}</p>{(inviteLoading||invite)&&<div className="auth-invite"><Link2/><span><small>登录后继续加入</small><b>{invite?.spaceName??'正在读取社区邀请…'}</b></span></div>}<label>用户名<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="2–20 位字符"/></label><label>密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void submit()}} placeholder={registering?'至少 8 位':'输入密码'}/></label><button className="primary" disabled={busy} onClick={submit}>{busy?'正在连接…':registering?'注册并开始':'登录'}</button><div className="auth-switch">{registering?'已有账号？':'第一次使用？'}<button onClick={()=>setRegistering(v=>!v)}>{registering?'返回登录':'免费注册'}</button></div></div></div>}
function SpaceDialog({initialMode,onCreate,onJoin,onClose}:{initialMode:'create'|'join';onCreate:(name:string)=>Promise<void>;onJoin:(code:string)=>Promise<void>;onClose:()=>void}){const[mode,setMode]=useState(initialMode);const[value,setValue]=useState('');const[busy,setBusy]=useState(false);const submit=async()=>{if(!value.trim())return;setBusy(true);try{if(mode==='create')await onCreate(value.trim());else await onJoin(value.trim())}finally{setBusy(false)}};return <div className="modal-backdrop"><div className="space-modal"><div className="modal-head"><div><h2>{mode==='join'?'加入一个社区':'创建你的社区'}</h2><p>{mode==='join'?'粘贴好友发来的 POIO 邀请链接或邀请码。':'创建后即可邀请好友加入语音频道。'}</p></div><button onClick={onClose}><X/></button></div><div className="space-mode"><button className={mode==='join'?'active':''} onClick={()=>{setMode('join');setValue('')}}><LogIn/>加入社区</button><button className={mode==='create'?'active':''} onClick={()=>{setMode('create');setValue('')}}><Plus/>创建社区</button></div><label>{mode==='join'?'邀请链接或邀请码':'社区名称'}<input autoFocus value={value} maxLength={mode==='join'?300:32} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void submit()}} placeholder={mode==='join'?'粘贴邀请链接，或输入 A1B2C3D4E5':'给社区起个名字'}/></label><button className="primary" disabled={busy||!value.trim()} onClick={()=>void submit()}>{busy?'请稍候…':mode==='join'?'加入社区':'创建社区'}</button></div></div>}
function ChannelDialog({kind,onCreate,onClose}:{kind:'text'|'voice';onCreate:(name:string,kind:'text'|'voice')=>Promise<void>;onClose:()=>void}){const[name,setName]=useState('');const[busy,setBusy]=useState(false);const submit=async()=>{const value=name.trim();if(!value)return;setBusy(true);try{await onCreate(value,kind)}finally{setBusy(false)}};return <div className="modal-backdrop"><div className="channel-modal"><div className="modal-head"><div><h2>创建{kind==='voice'?'语音':'文字'}频道</h2><p>{kind==='voice'?'成员可以在频道内语音、聊天和共享屏幕。':'为社区创建一个新的聊天空间。'}</p></div><button onClick={onClose}><X/></button></div><label>频道名称<input autoFocus value={name} maxLength={32} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void submit()}} placeholder={kind==='voice'?'例如：游戏大厅':'例如：攻略交流'}/></label><button className="primary" disabled={busy||!name.trim()} onClick={()=>void submit()}>{busy?'正在创建…':'创建频道'}</button></div></div>}
function InviteDialog({invite,onClose}:{invite:SpaceInvite;onClose:()=>void}){const[copied,setCopied]=useState<'link'|'code'>();const inviteUrl=window.echodeck?.platform==='web'?`${location.origin}/invite/${encodeURIComponent(invite.code)}`:invite.url;const copy=async(kind:'link'|'code')=>{await navigator.clipboard.writeText(kind==='link'?inviteUrl:invite.code);setCopied(kind);window.setTimeout(()=>setCopied(undefined),1600)};return <div className="modal-backdrop"><div className="invite-modal"><div className="modal-head"><div><h2>邀请好友加入</h2><p>{window.echodeck?.platform==='web'?'分享链接，对方可直接在浏览器加入。':'分享链接，好友未安装时会自动看到下载页面。'}</p></div><button onClick={onClose}><X/></button></div><div className="invite-community"><UserPlus/><div><span>邀请加入</span><b>{invite.spaceName}</b></div></div><div className="invite-link"><Link2/><span>{inviteUrl}</span><button onClick={()=>void copy('link')}>{copied==='link'?<Check/>:<Copy/>}{copied==='link'?'已复制':'复制邀请链接'}</button></div><div className="invite-code compact"><span>邀请码</span><code>{invite.code}</code><button onClick={()=>void copy('code')}>{copied==='code'?'已复制':'复制'}</button></div><small>邀请有效期至 {new Date(invite.expiresAt).toLocaleDateString('zh-CN')}。好友首次加入后会永久保留社区，无需再次输入。</small></div></div>}
function IncomingInviteDialog({invite,alreadyJoined,busy,onAccept,onClose}:{invite:InvitePreview;alreadyJoined:boolean;busy:boolean;onAccept:()=>void;onClose:()=>void}){return <div className="modal-backdrop invite-join-backdrop"><section className="incoming-invite"><button className="incoming-close" onClick={onClose}><X/></button><div className="incoming-icon"><UserPlus/></div><span className="incoming-label">POIO 社区邀请</span><h2>{invite.spaceName}</h2><p>{alreadyJoined?'你已经是这个社区的成员，可以直接打开。':`这个社区已有 ${invite.memberCount} 位成员，确认后将加入你的社区列表。`}</p><div className="incoming-meta"><span>邀请码 {invite.code}</span><span>有效期至 {new Date(invite.expiresAt).toLocaleDateString('zh-CN')}</span></div><footer><button className="secondary" disabled={busy} onClick={onClose}>暂不加入</button><button className="primary" disabled={busy} onClick={onAccept}>{busy?'正在加入…':alreadyJoined?'打开社区':'确认加入社区'}</button></footer></section></div>}
function GomokuInvitationCard({invitation,onAccept,onClose}:{invitation:GomokuInvitation;onAccept:()=>void;onClose:()=>void}){return <section className="gomoku-invitation-card"><button className="gomoku-invitation-close" onClick={onClose}><X/></button><div className="gomoku-invitation-icon"><Swords/></div><div className="gomoku-invitation-copy"><small>五子棋对局邀请</small><b>{invitation.inviter.username} 邀请你加入房间</b><span>每人 {invitation.wager.toLocaleString('zh-CN')} 积分 · 奖池 {invitation.pot.toLocaleString('zh-CN')}</span></div><footer><button onClick={onClose}>稍后</button><button className="accept" onClick={onAccept}><Play/>加入棋局</button></footer></section>}
function TexasInvitationCard({invitation,onAccept,onClose}:{invitation:TexasInvitation;onAccept:()=>void;onClose:()=>void}){return <section className="gomoku-invitation-card texas"><button className="gomoku-invitation-close" onClick={onClose}><X/></button><div className="gomoku-invitation-icon"><Crown/></div><div className="gomoku-invitation-copy"><small>德州扑克牌桌邀请</small><b>{invitation.inviter.username} 邀请你加入牌桌</b><span>盲注 {invitation.smallBlind.toLocaleString('zh-CN')}/{(invitation.smallBlind*2).toLocaleString('zh-CN')} · 带入 {invitation.buyIn.toLocaleString('zh-CN')} 积分</span></div><footer><button onClick={onClose}>稍后</button><button className="accept" onClick={onAccept}><Play/>加入牌桌</button></footer></section>}
function PoolInvitationCard({invitation,onAccept,onClose}:{invitation:PoolInvitation;onAccept:()=>void;onClose:()=>void}){return <section className="gomoku-invitation-card"><button className="gomoku-invitation-close" onClick={onClose}><X/></button><div className="gomoku-invitation-icon"><CircleDot/></div><div className="gomoku-invitation-copy"><small>8 球台球邀请</small><b>{invitation.inviter.username} 邀请你加入球桌</b><span>每人 {invitation.wager.toLocaleString('zh-CN')} 积分 · 奖池 {invitation.pot.toLocaleString('zh-CN')}</span></div><footer><button onClick={onClose}>稍后</button><button className="accept" onClick={onAccept}><Play/>加入球桌</button></footer></section>}
function CommunityManagement({space,members,onError,onClose}:{space:Space;members:SpaceMember[];onError:(error:unknown)=>void;onClose:()=>void}){
  const[spaceName,setSpaceName]=useState(space.name);const[channelNames,setChannelNames]=useState<Record<string,string>>(()=>Object.fromEntries(space.channels.map(channel=>[channel.id,channel.name])));const[busy,setBusy]=useState('');const[confirmKick,setConfirmKick]=useState('');const[confirmDelete,setConfirmDelete]=useState('');
  useEffect(()=>setSpaceName(space.name),[space.name]);useEffect(()=>setChannelNames(current=>Object.fromEntries(space.channels.map(channel=>[channel.id,current[channel.id]??channel.name]))),[space.channels]);
  const run=async(key:string,action:()=>Promise<unknown>)=>{if(busy)return;setBusy(key);try{await action()}catch(error){onError(error)}finally{setBusy('')}};
  const saveSpace=()=>run('space',()=>request('space:update',{spaceId:space.id,name:spaceName.trim()}));
  const moderate=(member:SpaceMember,kind:'textMuted'|'voiceMuted')=>run(`${member.id}:${kind}`,()=>request('space:moderateMember',{spaceId:space.id,userId:member.id,[kind]:!member[kind]}));
  const kick=(member:SpaceMember)=>{if(confirmKick!==member.id){setConfirmKick(member.id);return}void run(`kick:${member.id}`,()=>request('space:removeMember',{spaceId:space.id,userId:member.id}));setConfirmKick('')};
  const saveChannel=(channel:Channel)=>run(`channel:${channel.id}`,()=>request('channel:update',{channelId:channel.id,name:(channelNames[channel.id]??channel.name).trim()}));
  const removeChannel=(channel:Channel)=>{if(confirmDelete!==channel.id){setConfirmDelete(channel.id);return}void run(`delete:${channel.id}`,()=>request('channel:delete',{channelId:channel.id}));setConfirmDelete('')};
  return <div className="modal-backdrop management-backdrop"><section className="management-modal"><div className="modal-head"><div><span className="management-kicker"><Shield size={14}/>仅社区拥有者可操作</span><h2>社区与频道管理</h2><p>管理成员权限、社区资料和频道结构。</p></div><button onClick={onClose}><X/></button></div>
    <div className="management-scroll">
      <section className="management-section"><header><div><b>社区资料</b><span>修改后会实时同步给所有成员</span></div></header><div className="management-name"><input maxLength={32} value={spaceName} onChange={event=>setSpaceName(event.target.value)}/><button disabled={!spaceName.trim()||spaceName.trim()===space.name||busy==='space'} onClick={()=>void saveSpace()}><Save size={15}/>{busy==='space'?'保存中':'保存名称'}</button></div></section>
      <section className="management-section"><header><div><b>成员管理</b><span>{members.length} 位成员 · 禁言只影响当前社区</span></div></header><div className="management-list">{members.map(member=><article className="management-member" key={member.id}><Avatar name={member.username} avatarUrl={member.avatarUrl}/><div className="management-identity"><b>{member.username}{member.role==='owner'&&<Crown size={13}/>}</b><span>{member.role==='owner'?'社区拥有者':member.textMuted&&member.voiceMuted?'已禁言并关闭麦克风':member.textMuted?'已禁言':member.voiceMuted?'已关闭麦克风':'普通成员'}</span></div>{member.role!=='owner'&&<div className="moderation-actions"><button className={member.textMuted?'active':''} disabled={!!busy} title={member.textMuted?'解除聊天禁言':'禁止发送消息和文件'} onClick={()=>void moderate(member,'textMuted')}><MessageSquareOff size={15}/><span>{member.textMuted?'解除禁言':'禁言'}</span></button><button className={member.voiceMuted?'active':''} disabled={!!busy} title={member.voiceMuted?'允许使用麦克风':'在 Mumble 服务端关闭麦克风'} onClick={()=>void moderate(member,'voiceMuted')}><MicOff size={15}/><span>{member.voiceMuted?'开启麦克风':'关闭麦克风'}</span></button><button className={`danger ${confirmKick===member.id?'confirm':''}`} disabled={!!busy} onClick={()=>kick(member)}><UserMinus size={15}/><span>{confirmKick===member.id?'再次点击确认':'踢出社区'}</span></button></div>}</article>)}</div></section>
      <section className="management-section"><header><div><b>频道管理</b><span>至少保留一个文字频道和一个语音频道</span></div></header><div className="management-list">{space.channels.map(channel=><article className="management-channel" key={channel.id}><i>{channelIcon(channel.kind)}</i><div><span>{channel.kind==='voice'?'语音频道':'文字频道'}</span><input maxLength={32} value={channelNames[channel.id]??channel.name} onChange={event=>setChannelNames(current=>({...current,[channel.id]:event.target.value}))}/></div><button disabled={!!busy||!(channelNames[channel.id]??'').trim()||(channelNames[channel.id]??channel.name).trim()===channel.name} title="保存频道名称" onClick={()=>void saveChannel(channel)}><Pencil size={15}/></button><button className={`danger ${confirmDelete===channel.id?'confirm':''}`} disabled={!!busy} title={confirmDelete===channel.id?'再次点击确认删除':'删除频道'} onClick={()=>removeChannel(channel)}><Trash2 size={15}/><span>{confirmDelete===channel.id?'确认':'删除'}</span></button></article>)}</div></section>
    </div>
  </section></div>
}
function EmojiPicker({onPick}:{onPick:(emoji:string)=>void}){return <div className="emoji-picker">{['😀','😂','😍','😎','😭','😡','👍','👎','🎉','🔥','❤️','✅','🤔','👀','🙏','💯'].map(emoji=><button key={emoji} onClick={()=>onPick(emoji)}>{emoji}</button>)}</div>}
function updateStatusText(status:AppUpdateStatus){if(status.state==='checking')return '正在检查新版本…';if(status.state==='available')return `发现 ${status.version??'新版本'}，准备下载`;if(status.state==='downloading')return `正在后台下载 ${status.percent??0}%`;if(status.state==='downloaded')return `${status.version??'新版本'} 已下载完成`;if(status.state==='up-to-date')return '当前已是最新版';if(status.state==='error')return status.message??'更新检查失败';if(status.state==='development')return '正式安装版支持在线更新';return '启动后自动检查更新'}
function UpdateDialog({status,onClose,onDownload,onInstall,onRetry}:{status:AppUpdateStatus;onClose:()=>void;onDownload:()=>void;onInstall:()=>void;onRetry:()=>void}){
  const percent=Math.max(0,Math.min(100,status.percent??0));
  const downloading=status.state==='downloading';
  const downloaded=status.state==='downloaded';
  const failed=status.state==='error';
  const opensDmg=downloaded&&status.installMode==='open-dmg';
  const summary=opensDmg
    ?(status.message??'DMG 已下载完成；打开后 POIO 会自动退出，再将新版拖入“应用程序”覆盖旧版本。')
    :downloaded?'安装时 POIO 会重新启动，请先保存正在进行的工作。'
      :downloading?'下载会在后台继续，你可以暂时关闭这个窗口。'
        :failed?(status.message??'暂时无法完成更新，请稍后重试。'):'新版本已经准备好，确认后开始下载。';
  return <div className="modal-backdrop update-backdrop" onClick={onClose}><section className="update-modal" role="dialog" aria-modal="true" aria-label="POIO 客户端更新" onClick={event=>event.stopPropagation()}><button className="update-close" title="稍后处理" onClick={onClose}><X/></button><div className={`update-orb ${downloaded?'done':failed?'failed':''}`}>{downloaded?<Check/>:<Download/>}</div><div className="update-version"><span>POIO 客户端更新</span><b>{status.version?`v${status.version}`:'检查新版本'}</b></div><h2>{opensDmg?'DMG 已准备就绪':downloaded?'更新已准备就绪':downloading?'正在下载更新':failed?'更新遇到问题':'发现新版本'}</h2><p className="update-summary">{summary}</p>{!failed&&<div className="update-notes"><b>本次更新</b><p>{status.notes??'优化 POIO 桌面端体验、稳定性与在线更新流程。'}</p></div>}{(downloading||downloaded)&&<div className="update-progress"><div><span>{downloaded?'下载并校验完成':'正在下载安装包'}</span><b>{downloaded?100:percent}%</b></div><i><em style={{width:`${downloaded?100:percent}%`}}/></i></div>}<footer><button className="secondary" onClick={onClose}>{downloading?'后台下载':'稍后更新'}</button>{status.state==='available'&&<button className="primary" onClick={onDownload}><Download/>下载更新</button>}{downloading&&<button className="primary" disabled><span className="update-spinner"/>正在下载</button>}{downloaded&&<button className="primary ready" onClick={onInstall}>{opensDmg?<Download/>:<Check/>}{opensDmg?'打开 DMG 并退出':'重启并安装'}</button>}{failed&&<button className="primary" onClick={onRetry}>重新检查</button>}</footer><small>{status.installMode==='open-dmg'?'更新包校验完成后会打开 DMG 并退出 POIO，方便覆盖“应用程序”中的旧版本。':'更新安装包由 POIO 更新服务提供，下载完成后将由客户端自动校验。'}</small></section></div>
}
function ChannelGroup({title,onAdd,children}:{title:string;onAdd?:()=>void;children:any}){return <section><div className="group-title"><span><ChevronDown size={13}/>{title}</span>{onAdd&&<button onClick={onAdd}><Plus size={16}/></button>}</div>{children}</section>}
function ChannelItem({channel,active,voice,joining,unread,mentioned,onClick}:{channel:Channel;active:boolean;voice:boolean;joining:boolean;unread:number;mentioned:boolean;onClick:()=>void}){return <button className={`channel ${active?'active':''} ${mentioned?'mentioned':''}`} onClick={onClick}>{channelIcon(channel.kind)}<span>{channel.name}</span>{voice?<i className="voice-pill">已连接</i>:joining?<i className="voice-joining-pill">连接中</i>:mentioned?<i className="mention-pill">@</i>:unread>0&&<i className="unread-pill">{unread>99?'99+':unread}</i>}</button>}
function DirectConversationItem({item,active,unread,onClick}:{item:DirectConversation;active:boolean;unread:number;onClick:()=>void}){return <button className={`direct-conversation ${active?'active':''}`} onClick={onClick}><Avatar name={item.user.username} avatarUrl={item.user.avatarUrl}/><span><b>{item.user.username}</b><small>{directMessagePreview(item.lastMessage.body,item.lastMessage.attachmentName)}</small></span>{unread>0&&<i>{unread>99?'99+':unread}</i>}</button>}
function MemberRow({member,online=false,status,self=false,unread=0,onMessage}:{member:User&{role?:string};online?:boolean;status:string;self?:boolean;unread?:number;onMessage:()=>void}){return <div className={`member ${online?'':'offline'}`}><Avatar name={member.username} avatarUrl={member.avatarUrl}/><div><b>{member.username}{self&&<small>（你）</small>}{member.role==='owner'&&<Crown size={11}/>}</b><span>{status}</span></div>{online&&<span className="online-dot"/>}{!self&&<button className="member-message" title={`私聊 ${member.username}`} onClick={onMessage}><MessageCircle size={15}/>{unread>0&&<i>{unread>99?'99+':unread}</i>}</button>}</div>}
function DirectMessageView({peer,currentUser,messages,onSend,onJoinGame,onError,onClose,onPreview}:{peer:User;currentUser:User;messages:DirectMessage[];onSend:(body:string,file?:File)=>Promise<void>;onJoinGame:(gameId:'gomoku'|'texas-holdem'|'pool',spaceId:string,roomId:string)=>void;onError:(error:unknown)=>void;onClose:()=>void;onPreview:(url:string,name:string)=>void}){
  const[body,setBody]=useState('');
  const[file,setFile]=useState<File>();
  const[busy,setBusy]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const listRef=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{const list=listRef.current;if(list)list.scrollTop=list.scrollHeight},[messages,peer.id]);
  useEffect(()=>{setBody('');setFile(undefined)},[peer.id]);
  const submit=async()=>{const text=body.trim();if((!text&&!file)||busy)return;setBusy(true);try{await onSend(text,file);setBody('');setFile(undefined);if(fileRef.current)fileRef.current.value=''}catch(error){onError(error)}finally{setBusy(false)}};
  return <section className="direct-message-view">
    <header><div><Avatar name={peer.username} avatarUrl={peer.avatarUrl}/><span><b>{peer.username}</b><small>社区成员私聊 · 只有你们两人可见</small></span></div><button title="返回频道" onClick={onClose}><X size={18}/></button></header>
    <div ref={listRef} className="direct-message-list">{messages.length===0?<div className="direct-message-empty"><MessageCircle/><h2>开始与 {peer.username} 私聊</h2><p>你可以发送文字、图片和最大 50 MB 的文件。</p></div>:messages.map(message=><DirectMessageRow key={message.id} message={message} own={message.senderId===currentUser.id} onJoinGame={onJoinGame} onPreview={onPreview}/>)}</div>
    <div className="direct-composer"><input ref={fileRef} hidden type="file" onChange={event=>setFile(event.target.files?.[0])}/>{file&&<div className="direct-file-pending"><FileText/><span><b>{file.name}</b><small>{formatBytes(file.size)}</small></span><button onClick={()=>{setFile(undefined);if(fileRef.current)fileRef.current.value=''}}><X size={14}/></button></div>}<button className="direct-attach" disabled={busy} title="发送图片或文件" onClick={()=>fileRef.current?.click()}>{busy?<span className="upload-spinner"/>:<CirclePlus size={21}/>}</button><textarea maxLength={4000} value={body} onChange={event=>setBody(event.target.value)} onPaste={event=>{const pasted=event.clipboardData.files?.[0];if(pasted){event.preventDefault();setFile(pasted)}}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submit()}}} placeholder={`私聊 ${peer.username}`}/><button className="direct-send" disabled={busy||(!body.trim()&&!file)} onClick={()=>void submit()}><Send size={17}/></button></div>
  </section>;
}
function DirectMessageRow({message,own,onJoinGame,onPreview}:{message:DirectMessage;own:boolean;onJoinGame:(gameId:'gomoku'|'texas-holdem'|'pool',spaceId:string,roomId:string)=>void;onPreview:(url:string,name:string)=>void}){const[copied,setCopied]=useState(false);const url=message.attachmentUrl?`${serverUrl}${message.attachmentUrl}`:'';const image=message.attachmentMime?.startsWith('image/');const invitation=parseDirectGameInvitation(message.body);const copy=async()=>{const text=invitation?(invitation.gameId==='gomoku'?'五子棋对局邀请':invitation.gameId==='pool'?'8 球台球邀请':'德州扑克牌桌邀请'):message.body||url||message.attachmentName||'';if(!text)return;await navigator.clipboard.writeText(text);setCopied(true);window.setTimeout(()=>setCopied(false),1200)};return <div className={`direct-message-row ${own?'own':''}`}><Avatar name={message.username} avatarUrl={message.avatarUrl}/><div><div className="direct-message-meta"><b>{own?'你':message.username}</b><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time><button title={copied?'已复制':'复制消息'} onClick={()=>void copy()}>{copied?<Check size={13}/>:<Copy size={13}/>}</button></div>{invitation?<DirectGameInviteCard invitation={invitation} own={own} onJoin={()=>onJoinGame(invitation.gameId,invitation.spaceId,invitation.roomId)}/>:message.body&&<MarkdownContent body={message.body}/>} {url&&(image?<button className="image-attachment" onClick={()=>onPreview(url,message.attachmentName??'图片')}><img src={url}/><span><Image size={13}/>{message.attachmentName}</span></button>:<a className="file-attachment" href={url} target="_blank" rel="noreferrer"><FileText/><span><b>{message.attachmentName}</b><small>{formatBytes(message.attachmentSize??0)}</small></span><Download size={17}/></a>)}</div></div>}
function DirectGameInviteCard({invitation,own,onJoin}:{invitation:DirectGameInvitation;own:boolean;onJoin:()=>void}){const expired=invitation.expiresAt<=Date.now(),texas=invitation.gameId==='texas-holdem',pool=invitation.gameId==='pool',name=texas?'德州扑克':pool?'8 球台球':'五子棋';return <button className={`direct-gomoku-invite ${texas?'texas':''} ${expired?'expired':''}`} disabled={expired} onClick={onJoin}><span className="direct-gomoku-icon">{texas?<Crown/>:pool?<CircleDot/>:<Swords/>}</span><span><small>{own?`你发起了${name}邀请`:texas?'德州扑克牌桌邀请':pool?'8 球台球邀请':'五子棋对局邀请'}</small><b>{expired?'这张邀请已过期':own?'等待对方加入':pool?'点击加入球桌':texas?'点击加入牌桌':'点击加入棋桌'}</b><em>{texas?`带入 ${invitation.wager.toLocaleString('zh-CN')} 积分 · 盲注 ${Number(invitation.metadata?.smallBlind??0).toLocaleString('zh-CN')}`:`每人 ${invitation.wager.toLocaleString('zh-CN')} 积分 · 奖池 ${invitation.pot.toLocaleString('zh-CN')}`}</em></span><Play/></button>}
function VoiceMember({user,self,connected,talking,volume,onVolume}:{user:User;self:boolean;connected:boolean;talking:boolean;volume:number;onVolume:(value:number)=>void}){return <div className={`voice-member ${talking?'speaking':''}`}><Avatar name={user.username} avatarUrl={user.avatarUrl}/><span>{user.username}{self?'（你）':''}</span>{talking&&<i className="talking-wave"><b/><b/><b/></i>}{self?<Mic size={13}/>:<div className="member-volume-wrap"><button disabled={!connected} title={connected?`调节 ${user.username} 的音量`:'加入该频道后可调节音量'}>{volume===0?<VolumeX size={13}/>:<Volume2 size={13}/>}</button>{connected&&<div className="member-volume-popover"><div><span><Volume2 size={14}/>{user.username}</span><b>{volume}%</b></div><input className="volume-range" type="range" min="0" max="200" value={volume} onChange={event=>onVolume(Number(event.target.value))}/><footer><span>仅调整你听到的音量</span><button onClick={()=>onVolume(100)}>重置 100%</button></footer></div>}</div>}</div>}
function AudioControlPopover({kind,volume,devices,onVolume,onDevice,onSettings}:{kind:'input'|'output';volume:number;devices:MumbleAudioDevice[];onVolume:(value:number)=>void;onDevice:(index:number)=>void;onSettings:()=>void}){const input=kind==='input';return <div className="audio-popover"><div className="audio-popover-title"><span>{input?<Mic size={15}/>:<Headphones size={15}/>} {input?'麦克风音量':'耳机音量'}</span><b>{volume}%</b></div><input className="volume-range" type="range" min="0" max={input?100:200} value={volume} onChange={event=>onVolume(Number(event.target.value))}/><label>{input?'输入设备':'输出设备'}<select value={devices.find(device=>device.selected)?.index??''} onChange={event=>onDevice(Number(event.target.value))}>{!devices.length&&<option value="">正在读取设备…</option>}{devices.map(device=><option key={device.index} value={device.index}>{device.name}</option>)}</select></label><button className="audio-settings-link" onClick={onSettings}><Settings size={14}/>语音设置</button></div>}
function Avatar({name,avatarUrl}:{name:string;avatarUrl?:string}){const hue=[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%360;return <div className={`avatar ${avatarUrl?'custom':''}`} style={{background:`linear-gradient(145deg,hsl(${hue} 74% 60%),hsl(${(hue+34)%360} 74% 42%))`}}>{avatarUrl?<img src={`${serverUrl}${avatarUrl}`} alt={name}/>:name.slice(0,1).toUpperCase()}</div>}
function Message({message,compact,currentUserId,canModerate,reactionOpen,onToggleReactionPicker,onReact,onReply,onEdit,onDelete,onPreview}:{message:ChatMessage;compact:boolean;currentUserId:string;canModerate:boolean;reactionOpen:boolean;onToggleReactionPicker:()=>void;onReact:(emoji:string)=>void;onReply:()=>void;onEdit:()=>void;onDelete:()=>void;onPreview:(url:string,name:string)=>void}){const url=message.attachmentUrl?`${serverUrl}${message.attachmentUrl}`:'';const image=message.attachmentMime?.startsWith('image/');const own=message.userId===currentUserId;const[copied,setCopied]=useState(false);const copyMessage=async()=>{const text=message.body||url||message.attachmentName||'';if(!text)return;try{await navigator.clipboard.writeText(text)}catch{const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();document.execCommand('copy');input.remove()}setCopied(true);window.setTimeout(()=>setCopied(false),1400)};return <div data-message-id={message.id} className={`message ${compact?'compact':''} ${message.deleted?'deleted':''}`}>{!compact&&<Avatar name={message.username} avatarUrl={message.avatarUrl}/>}<div>{!compact&&<div className="message-meta"><b>{message.username}</b><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time>{message.editedAt&&<small>已编辑</small>}</div>}{message.reply&&<div className={`message-reply ${message.reply.deleted?'deleted':''}`}><Quote size={13}/><span><b>{message.reply.username}</b><small>{message.reply.deleted?'原消息已撤回':message.reply.body||message.reply.attachmentName||'附件'}</small></span></div>}{message.deleted?<div className="message-deleted"><Trash2 size={13}/>消息已撤回</div>:<>{message.body&&<MarkdownContent body={message.body}/>} {url&&(image?<button className="image-attachment" onClick={()=>onPreview(url,message.attachmentName??'图片')}><img src={url}/><span><Image size={13}/>{message.attachmentName}</span></button>:<a className="file-attachment" href={url} target="_blank"><FileText/><span><b>{message.attachmentName}</b><small>{formatBytes(message.attachmentSize??0)}</small></span><Download size={17}/></a>)}</>}{!message.deleted&&<div className="message-reactions">{message.reactions.map(reaction=><button key={reaction.emoji} className={reaction.userIds.includes(currentUserId)?'active':''} title={`${reaction.count} 个回应`} onClick={()=>onReact(reaction.emoji)}><span>{reaction.emoji}</span><b>{reaction.count}</b></button>)}</div>}</div>{!message.deleted&&<div className="message-actions"><button title="回复" onClick={onReply}><Quote size={14}/></button><button className={copied?'copied':''} title={copied?'已复制':'复制消息'} onClick={()=>void copyMessage()}>{copied?<Check size={14}/>:<Copy size={14}/>}</button><button className={reactionOpen?'active':''} title="添加回应" onClick={onToggleReactionPicker}><Smile size={14}/></button>{own&&<button title="编辑" onClick={onEdit}><Pencil size={14}/></button>}{(own||canModerate)&&<button className="danger" title="撤回消息" onClick={onDelete}><Trash2 size={14}/></button>}{reactionOpen&&<div className="message-reaction-picker">{MESSAGE_REACTIONS.map(emoji=><button key={emoji} onClick={()=>onReact(emoji)}>{emoji}</button>)}</div>}</div>}</div>}
function MarkdownContent({body,className=''}:{body:string;className?:string}){return <div className={`markdown-body ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{a:({children,...props})=><a {...props} target="_blank" rel="noreferrer">{children}</a>,pre:({children})=>{const child=Array.isArray(children)?children[0]:children;const text=String((child as any)?.props?.children??'').replace(/\n$/,'');const language=String((child as any)?.props?.className??'').replace(/^language-/,'')||'代码';return <div className="markdown-code"><header><span>{language}</span><button onClick={()=>void navigator.clipboard.writeText(text)}><Copy size={13}/>复制</button></header><pre>{children}</pre></div>}}}>{body}</ReactMarkdown></div>}
function ImagePreview({url,name,onClose}:{url:string;name:string;onClose:()=>void}){return <div className="image-preview-backdrop" onClick={onClose}><div className="image-preview" onClick={event=>event.stopPropagation()}><header><span><Image/><b>{name}</b></span><div><a href={url} target="_blank"><Download/>打开原图</a><button onClick={onClose}><X/></button></div></header><img src={url} alt={name}/></div></div>}
function ScreenshotSelector({capture,onConfirm,onClose}:{capture:ScreenshotCapture;onConfirm:(file:File)=>void;onClose:()=>void}){const imageRef=useRef<HTMLImageElement>(null);const origin=useRef<{x:number;y:number}|undefined>(undefined);const[selection,setSelection]=useState<{x:number;y:number;width:number;height:number}>();const[busy,setBusy]=useState(false);useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose]);const point=(event:React.PointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(rect.width,event.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,event.clientY-rect.top))}};const move=(event:React.PointerEvent<HTMLDivElement>)=>{if(!origin.current)return;const current=point(event);setSelection({x:Math.min(origin.current.x,current.x),y:Math.min(origin.current.y,current.y),width:Math.abs(current.x-origin.current.x),height:Math.abs(current.y-origin.current.y)})};const confirm=async()=>{const image=imageRef.current;if(!image)return;setBusy(true);try{const rect=image.getBoundingClientRect();const area=selection&&selection.width>=4&&selection.height>=4?selection:{x:0,y:0,width:rect.width,height:rect.height};const scaleX=image.naturalWidth/rect.width;const scaleY=image.naturalHeight/rect.height;const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(area.width*scaleX));canvas.height=Math.max(1,Math.round(area.height*scaleY));canvas.getContext('2d')?.drawImage(image,Math.round(area.x*scaleX),Math.round(area.y*scaleY),canvas.width,canvas.height,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('截图生成失败')),'image/png'));const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);onConfirm(new File([blob],`POIO截图-${stamp}.png`,{type:'image/png'}))}finally{setBusy(false)}};return <div className="screenshot-backdrop"><div className="screenshot-head"><div><Scissors/><span><b>区域截图</b><small>{capture.displayName} · 拖动鼠标选择范围，按 Esc 取消</small></span></div><div><button onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={()=>void confirm()}>{busy?'处理中…':selection&&selection.width>=4?'添加到消息':'截取完整屏幕'}</button></div></div><div className="screenshot-workspace"><div className="screenshot-image-wrap"><img ref={imageRef} src={capture.dataUrl}/><div className="screenshot-hit" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);const start=point(event);origin.current=start;setSelection({...start,width:0,height:0})}} onPointerMove={move} onPointerUp={event=>{move(event);origin.current=undefined}}>{selection&&<div className="screenshot-selection" style={selection}/>}</div></div></div></div>}
function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1048576).toFixed(1)} MB`}
function MediaStage({local,localActive,remote,members,shareStatus,onStop}:{local?:MediaStream;localActive:boolean;remote:RemoteMedia[];members:User[];shareStatus:ScreenShareStatus;onStop:()=>void}){const localRoute=shareStatus.directViewers?`P2P 直连 ${shareStatus.directViewers} 人${shareStatus.turnViewers?` · TURN ${shareStatus.turnViewers} 人`:''}`:shareStatus.turnViewers?`TURN 中转 ${shareStatus.turnViewers} 人`:shareStatus.connecting?'正在建立 P2P 直连':'服务器转发兜底';const localRouteKind=shareStatus.directViewers?'p2p':shareStatus.turnViewers?'turn':'sfu';const localDiagnostics=shareStatus.diagnostics??shareStatus.viewers.find(viewer=>viewer.route==='p2p')?.diagnostics??shareStatus.viewers[0]?.diagnostics;return <div className="media-stage">{local?<VideoTile stream={local} label="你的屏幕" route={localRoute} routeKind={localRouteKind} diagnostics={localDiagnostics} local onStop={onStop}/>:localActive?<LocalShareTile route={localRoute} routeKind={localRouteKind} diagnostics={localDiagnostics} onStop={onStop}/>:null} {remote.filter(m=>m.tag==='screen').map(m=><VideoTile key={m.id} stream={m.stream} label={`${members.find(member=>member.id===m.userId)?.username??'成员'} 的屏幕`} route={m.route==='p2p'?'P2P 直连':m.route==='turn'?'TURN 中转':'服务器转发'} routeKind={m.route} diagnostics={m.diagnostics}/>) } {remote.filter(m=>m.kind==='audio').map(m=><Audio key={m.id} stream={m.stream}/>)}</div>}
function LocalShareTile({route,routeKind,diagnostics,onStop}:{route:string;routeKind:'sfu'|'p2p'|'turn';diagnostics?:ScreenDiagnostics;onStop:()=>void}){const diagnosticText=formatScreenDiagnostics(diagnostics);const limitation=qualityLimitationLabel(diagnostics?.qualityLimitationReason);return <div className="video-tile local-share-tile"><div className="local-share-visual"><span><MonitorUp/></span><b>正在共享你的屏幕</b><p>本机预览已隐藏，避免画面递归并降低显卡占用</p></div><span className={`video-route ${routeKind}`}>{route}</span>{diagnosticText&&<div className={`video-diagnostics ${diagnostics?.qualityLimitationReason&&diagnostics.qualityLimitationReason!=='none'?'limited':''}`} title={diagnostics?.implementation}><b>{diagnosticText}</b>{limitation&&<span>{limitation}</span>}</div>}<div className="video-actions"><button className="stop-share" onClick={onStop}><X size={15}/>停止共享</button></div></div>}
function VideoTile({stream,label,route,routeKind,diagnostics,local,onStop}:{stream:MediaStream;label:string;route:string;routeKind:'sfu'|'p2p'|'turn';diagnostics?:ScreenDiagnostics;local?:boolean;onStop?:()=>void}){const ref=useRef<HTMLVideoElement>(null);const tileRef=useRef<HTMLDivElement>(null);const[fullscreen,setFullscreen]=useState(false);useEffect(()=>{if(ref.current)ref.current.srcObject=stream},[stream]);useEffect(()=>{const changed=()=>setFullscreen(document.fullscreenElement===tileRef.current);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed)},[]);const toggleFullscreen=async()=>{if(local)return;if(document.fullscreenElement)await document.exitFullscreen();else await tileRef.current?.requestFullscreen()};const diagnosticText=formatScreenDiagnostics(diagnostics);const limitation=qualityLimitationLabel(diagnostics?.qualityLimitationReason);return <div ref={tileRef} className={`video-tile ${local?'local-video-tile':''}`}><video ref={ref} autoPlay playsInline muted={local} onDoubleClick={local?undefined:()=>void toggleFullscreen()}/><span className="video-label">{label}</span><span className={`video-route ${routeKind}`}>{route}</span>{diagnosticText&&<div className={`video-diagnostics ${diagnostics?.qualityLimitationReason&&diagnostics.qualityLimitationReason!=='none'?'limited':''}`} title={diagnostics?.implementation}><b>{diagnosticText}</b>{limitation&&<span>{limitation}</span>}</div>}<div className="video-actions">{!local&&<button className="fullscreen-control" title={fullscreen?'退出全屏':'全屏观看'} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{fullscreen?'退出全屏':'全屏'}</span></button>}{local&&<button className="stop-share" onClick={onStop}><X size={15}/>停止共享</button>}</div></div>}
function formatScreenDiagnostics(value?:ScreenDiagnostics){if(!value)return '';const parts:string[]=[];if(value.width&&value.height)parts.push(`${value.width}×${value.height}`);if(value.fps)parts.push(`${Math.round(value.fps)}fps`);if(value.bitrateMbps!==undefined)parts.push(`${value.bitrateMbps.toFixed(1)}Mbps`);if(value.rttMs!==undefined)parts.push(`${Math.round(value.rttMs)}ms`);if(value.packetLossPercent!==undefined&&value.packetLossPercent>=0.1)parts.push(`丢包 ${value.packetLossPercent.toFixed(1)}%`);if(value.powerEfficient===true)parts.push('硬件编解码');return parts.join(' · ')}
function qualityLimitationLabel(reason?:string){if(!reason||reason==='none')return '';if(reason==='bandwidth')return '网络正在限制画质';if(reason==='cpu')return '编码器负载过高';if(reason==='other')return '系统正在限制画质';return `画质受限：${reason}`}
function Audio({stream}:{stream:MediaStream}){const ref=useRef<HTMLAudioElement>(null);useEffect(()=>{if(ref.current)ref.current.srcObject=stream},[stream]);return <audio ref={ref} autoPlay/>}
function SharePicker({sources,loading,error,profile,setProfile,includeAudio,setIncludeAudio,onPick,onRetry,onClose}:{sources:any[];loading:boolean;error:string;profile:ShareProfile;setProfile:(v:ShareProfile)=>void;includeAudio:boolean;setIncludeAudio:(value:boolean)=>void;onPick:(id:string,nativeId?:string)=>void;onRetry:()=>void;onClose:()=>void}){
  return <div className="modal-backdrop"><div className="share-modal"><div className="modal-head"><div><h2>共享你的屏幕</h2><p>选择窗口与画质，POIO 会优先保持低延迟。</p></div><button onClick={onClose}><X/></button></div><div className="profiles">{([['smooth','流畅','720p · 30fps · 3Mbps'],['hd','高清','1080p · 30fps · 9Mbps'],['fps','高帧率','1080p · 60fps · 最高18Mbps'],['original','原画','源分辨率 · 最高35Mbps']] as const).map(([id,name,detail])=><button className={profile===id?'active':''} onClick={()=>setProfile(id)} key={id}><b>{name}</b><span>{detail}</span></button>)}</div><label className="share-audio-option"><input type="checkbox" checked={includeAudio} onChange={event=>setIncludeAudio(event.target.checked)}/><span><Volume2/><b>共享系统声音</b><small>让观看者同时听到游戏、视频或应用声音；共享整个屏幕时兼容性最好。</small></span></label>{loading&&sources.length===0?<div className="source-loading"><span className="source-spinner"/><b>正在读取屏幕和窗口</b><small>首次读取可能需要一点时间，弹框不会再阻塞。</small><div><i/><i/><i/></div></div>:error&&sources.length===0?<div className="source-loading failed"><b>无法读取共享来源</b><small>{error}</small><button onClick={onRetry}>重新加载</button></div>:<><div className="source-grid">{sources.map(s=><button key={s.id} onClick={()=>onPick(s.id,s.nativeId)}><img src={s.thumbnail}/><span>{s.name}</span></button>)}</div>{loading&&<div className="source-refreshing"><span className="source-spinner"/>正在刷新窗口列表…</div>}</>}</div></div>
}
const shortcutNames:Record<string,string>={Space:'空格',Tab:'Tab',Enter:'Enter',CapsLock:'Caps Lock',Backquote:'`',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Insert:'Insert',Delete:'Delete',Home:'Home',End:'End',PageUp:'Page Up',PageDown:'Page Down'};
function keyboardShortcut(event:KeyboardEvent):VoiceShortcut|undefined{
  if(['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(event.code))return;
  const virtualKey=event.keyCode;
  if(!Number.isInteger(virtualKey)||virtualKey<1||virtualKey>255||virtualKey===229)return;
  const modifiers=(event.shiftKey?1:0)|(event.ctrlKey?2:0)|(event.altKey?4:0)|(event.metaKey?8:0);
  const keyLabel=event.code.startsWith('Key')?event.code.slice(3):event.code.startsWith('Digit')?event.code.slice(5):event.code.startsWith('F')&&/^F\d+$/.test(event.code)?event.code:shortcutNames[event.code]??event.key;
  const parts=[event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.metaKey?'Win':'',keyLabel.toLocaleUpperCase('zh-CN')].filter(Boolean);
  return {virtualKey,modifiers,label:parts.join(' + ')};
}
const sameShortcut=(left:VoiceShortcut,right:VoiceShortcut)=>left.virtualKey===right.virtualKey&&left.modifiers===right.modifiers;
type AudioSettingsProps={
  connected:boolean;
  devices?:MumbleAudioDevices;
  busy:boolean;
  micLevel:number;
  joinSoundBusy:boolean;
  joinSoundUrl?:string;
  leaveSoundBusy:boolean;
  leaveSoundUrl?:string;
  voiceJoinCuesEnabled:boolean;
  onToggleVoiceJoinCues:(enabled:boolean)=>void;
  onUploadJoinSound:(file?:File)=>Promise<void>;
  onRemoveJoinSound:()=>Promise<void>;
  onTestJoinSound:()=>void;
  onUploadLeaveSound:(file?:File)=>Promise<void>;
  onRemoveLeaveSound:()=>Promise<void>;
  onTestLeaveSound:()=>void;
  onRefresh:()=>Promise<void>;
  onSelect:(kind:'input'|'output',index:number)=>Promise<void>;
  onClose:()=>void;
};
function AudioSettings({connected,devices,busy,micLevel,joinSoundBusy,joinSoundUrl,leaveSoundBusy,leaveSoundUrl,voiceJoinCuesEnabled,onToggleVoiceJoinCues,onUploadJoinSound,onRemoveJoinSound,onTestJoinSound,onUploadLeaveSound,onRemoveLeaveSound,onTestLeaveSound,onRefresh,onSelect,onClose}:AudioSettingsProps){
  const isWeb=window.echodeck?.platform==='web';
  const [testing,setTesting]=useState(false);
  const joinSoundInputRef=useRef<HTMLInputElement>(null);
  const leaveSoundInputRef=useRef<HTMLInputElement>(null);
  const [diagnosticsState,setDiagnosticsState]=useState<'idle'|'copying'|'copied'>('idle');
  const [preferences,setPreferences]=useState<DesktopPreferences>({closeToTray:true,launchAtLogin:false,muteShortcut:{virtualKey:77,modifiers:3,label:'Ctrl + Shift + M'},pushToTalkEnabled:false,pushToTalkShortcut:{virtualKey:86,modifiers:0,label:'V'}});
  const [preferencesBusy,setPreferencesBusy]=useState(false);
  const [capturing,setCapturing]=useState<'mute'|'pushToTalk'>();
  const [shortcutError,setShortcutError]=useState('');
  const input=devices?.inputs.find(d=>d.selected)?.index??'';
  const output=devices?.outputs.find(d=>d.selected)?.index??'';
  const level=testing?Math.max(0,Math.min(1,(micLevel-.18)/.82)):0;
  useEffect(()=>{void window.echodeck?.preferences.get().then(setPreferences)},[]);
  const changePreference=async(patch:Partial<DesktopPreferences>)=>{if(preferencesBusy)return;setPreferencesBusy(true);try{const next=await window.echodeck?.preferences.set(patch);if(next)setPreferences(next)}catch(error){setShortcutError(error instanceof Error?error.message:'设置保存失败，请重试')}finally{setPreferencesBusy(false)}};
  const saveShortcut=async(kind:'mute'|'pushToTalk',shortcut:VoiceShortcut)=>{
    const other=kind==='mute'?preferences.pushToTalkShortcut:preferences.muteShortcut;
    if(sameShortcut(shortcut,other)){setShortcutError('静音和按键说话不能使用同一个快捷键');return}
    setShortcutError('');
    setCapturing(undefined);
    await changePreference(kind==='mute'?{muteShortcut:shortcut}:{pushToTalkShortcut:shortcut});
  };
  useEffect(()=>{
    if(!capturing)return;
    const capture=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setCapturing(undefined);setShortcutError('');return}
      const shortcut=keyboardShortcut(event);
      if(!shortcut)return;
      event.preventDefault();
      event.stopPropagation();
      void saveShortcut(capturing,shortcut);
    };
    window.addEventListener('keydown',capture,true);
    return()=>window.removeEventListener('keydown',capture,true);
  },[capturing,preferences]);
  const captureMouse=(event:React.MouseEvent<HTMLButtonElement>)=>{
    if(!capturing||!event.button||event.button<3||event.button>4)return;
    event.preventDefault();
    const shortcut:VoiceShortcut={virtualKey:event.button===3?5:6,modifiers:0,label:event.button===3?'鼠标侧键 1':'鼠标侧键 2'};
    void saveShortcut(capturing,shortcut);
  };
  const copyDiagnostics=async()=>{setDiagnosticsState('copying');try{await navigator.clipboard.writeText(await electronBridge().diagnostics());setDiagnosticsState('copied');window.setTimeout(()=>setDiagnosticsState('idle'),1800)}catch{setDiagnosticsState('idle')}};
  return <div className="modal-backdrop">
    <div className="settings-modal">
      <div className="modal-head">
        <div><h2>设置</h2><p>{isWeb?'管理频道提示音和浏览器语音设备。':'管理桌面行为、频道提示音、全局快捷键和 Mumble 原生语音设备。'}</p></div>
        <button onClick={onClose}><X/></button>
      </div>
      {!isWeb&&<section className="desktop-preferences">
        <b>桌面行为</b>
        <label className="preference-row">
          <Minimize2/><span><strong>关闭时最小化到托盘</strong><small>保持语音和后台下载不中断，可从托盘菜单真正退出。</small></span>
          <input disabled={preferencesBusy} type="checkbox" checked={preferences.closeToTray} onChange={event=>void changePreference({closeToTray:event.target.checked})}/>
        </label>
        <label className="preference-row">
          <Power/><span><strong>开机时自动启动 POIO</strong><small>登录 Windows 后在托盘后台启动，不打扰桌面。</small></span>
          <input disabled={preferencesBusy} type="checkbox" checked={preferences.launchAtLogin} onChange={event=>void changePreference({launchAtLogin:event.target.checked})}/>
        </label>
      </section>}
      {!isWeb&&<section className="voice-shortcut-settings">
        <div className="voice-shortcut-title"><span><Keyboard/><b>全局语音快捷键</b><small>游戏在前台、POIO 在托盘时也能使用。</small></span></div>
        <div className="shortcut-row">
          <span><MicOff/><b>麦克风静音</b><small>按一次静音，再按一次恢复。</small></span>
          <button className={capturing==='mute'?'capturing':''} disabled={preferencesBusy} onMouseDown={captureMouse} onClick={()=>{setShortcutError('');setCapturing('mute')}}>{capturing==='mute'?'请按键或鼠标侧键…':preferences.muteShortcut.label}</button>
        </div>
        <label className="preference-row ptt-toggle">
          <Mic/><span><strong>按住说话</strong><small>开启后关闭自动语音检测；按住快捷键发送，松开立即停止。</small></span>
          <input disabled={preferencesBusy} type="checkbox" checked={preferences.pushToTalkEnabled} onChange={event=>void changePreference({pushToTalkEnabled:event.target.checked})}/>
        </label>
        {preferences.pushToTalkEnabled&&<div className="shortcut-row">
          <span><Keyboard/><b>按键说话快捷键</b><small>推荐使用鼠标侧键，避免影响游戏操作。</small></span>
          <button className={capturing==='pushToTalk'?'capturing':''} disabled={preferencesBusy} onMouseDown={captureMouse} onClick={()=>{setShortcutError('');setCapturing('pushToTalk')}}>{capturing==='pushToTalk'?'请按住想使用的键…':preferences.pushToTalkShortcut.label}</button>
        </div>}
        {shortcutError&&<p className="shortcut-error">{shortcutError}</p>}
        <p className="shortcut-note">录入时按 Esc 取消。全局监听由 POIO 的 Mumble 原生语音核心完成，不会记录输入内容。</p>
      </section>}
      <section className="join-sound-settings">
        <div className="join-sound-heading"><BellRing/><span><b>语音频道提示音</b><small>进入或离开语音频道时，你和频道里的其他成员都会听到相应提示音。</small></span></div>
        <label className="preference-row join-cue-toggle">
          <Volume2/><span><strong>播放进出频道提示音</strong><small>关闭后，你不会听到自己或他人的进入、离开提示音。</small></span>
          <input type="checkbox" checked={voiceJoinCuesEnabled} onChange={event=>onToggleVoiceJoinCues(event.target.checked)}/>
        </label>
        <div className="join-sound-file">
          <span><b>{joinSoundUrl?'已设置自定义加入音':'使用 POIO 默认加入音'}</b><small>{joinSoundUrl?'其他人在频道里会听到你设置的声音。':'上传后，别人会在你加入频道时听到它。'}</small></span>
          <div>
            <button disabled={joinSoundBusy} onClick={onTestJoinSound}><Play/>{joinSoundUrl?'试听':'试听默认音'}</button>
            <button disabled={joinSoundBusy} onClick={()=>joinSoundInputRef.current?.click()}><Upload/>{joinSoundBusy?'上传中…':joinSoundUrl?'更换':'上传'}</button>
            {joinSoundUrl&&<button className="danger-subtle" disabled={joinSoundBusy} onClick={()=>void onRemoveJoinSound()}>恢复默认</button>}
          </div>
          <input ref={joinSoundInputRef} hidden type="file" accept=".mp3,.ogg,.wav,.m4a,.aac,.webm,audio/*" onChange={event=>{const file=event.target.files?.[0];event.target.value='';void onUploadJoinSound(file)}}/>
        </div>
        <div className="join-sound-file">
          <span><b>{leaveSoundUrl?'已设置自定义退出音':'使用 POIO 默认退出音'}</b><small>{leaveSoundUrl?'你离开频道时，频道成员会听到这个声音。':'上传后，你离开频道时会播放自定义声音。'}</small></span>
          <div>
            <button disabled={leaveSoundBusy} onClick={onTestLeaveSound}><Play/>{leaveSoundUrl?'试听':'试听默认音'}</button>
            <button disabled={leaveSoundBusy} onClick={()=>leaveSoundInputRef.current?.click()}><Upload/>{leaveSoundBusy?'上传中…':leaveSoundUrl?'更换':'上传'}</button>
            {leaveSoundUrl&&<button className="danger-subtle" disabled={leaveSoundBusy} onClick={()=>void onRemoveLeaveSound()}>恢复默认</button>}
          </div>
          <input ref={leaveSoundInputRef} hidden type="file" accept=".mp3,.ogg,.wav,.m4a,.aac,.webm,audio/*" onChange={event=>{const file=event.target.files?.[0];event.target.value='';void onUploadLeaveSound(file)}}/>
        </div>
        <p className="join-sound-limits">支持 MP3、OGG、WAV、M4A、AAC、WebM；最大 2 MB，时长 0.1–4 秒。</p>
      </section>
      <div className="settings-section-title">语音设备</div>
      {!connected?<div className="settings-empty"><Headphones/><b>先加入语音频道</b><span>连接后即可读取并切换麦克风和扬声器。</span></div>:<>
        <div className="engine-card"><div className="engine-dot"/><div><b>{isWeb?'POIO WebRTC':'Mumble Native'}</b><span>{devices?.inputBackend??(isWeb?'MediaDevices':'WASAPI')} / {devices?.outputBackend??(isWeb?'Web Audio':'WASAPI')} · 低延迟模式</span></div><button disabled={busy} onClick={()=>void onRefresh()}>{busy?'读取中…':'刷新设备'}</button></div>
        <label className="device-field"><span><Mic/>输入设备</span><select disabled={busy||!devices?.inputs.length} value={input} onChange={event=>void onSelect('input',Number(event.target.value))}>{!devices?.inputs.length&&<option value="">未检测到输入设备</option>}{devices?.inputs.map(device=><option value={device.index} key={device.index}>{device.name}</option>)}</select><small>选择用于发送语音的麦克风。</small></label>
        <div className={`mic-test ${testing?'testing':''}`}><div className="mic-test-head"><span><Mic/>麦克风测试</span><button onClick={()=>setTesting(value=>!value)}>{testing?'停止测试':'开始测试'}</button></div><div className="mic-test-track"><i style={{width:`${Math.round(level*100)}%`}}/></div><small>{testing?(level>.25?'已检测到声音，对着麦克风说话时音量条会实时变化。':'正在监听，请对着麦克风说话…'):'点击开始测试，检查麦克风输入音量。'}</small></div>
        <label className="device-field"><span><Volume2/>输出设备</span><select disabled={busy||!devices?.outputs.length} value={output} onChange={event=>void onSelect('output',Number(event.target.value))}>{!devices?.outputs.length&&<option value="">未检测到输出设备</option>}{devices?.outputs.map(device=><option value={device.index} key={device.index}>{device.name}</option>)}</select><small>选择用于播放频道语音的耳机或扬声器。</small></label>
        <p className="settings-note">{isWeb?'设备选择会保存在当前浏览器中；首次使用时请允许麦克风权限。':'切换时语音会短暂重启，当前频道连接不会断开。选择结果会由 Mumble 保存。'}</p>
      </>}
      <div className="diagnostics-row"><div><b>遇到问题？</b><span>复制不含密码的运行环境和音频核心状态。</span></div><button disabled={diagnosticsState==='copying'} onClick={()=>void copyDiagnostics()}>{diagnosticsState==='copied'?<Check/>:<Copy/>}{diagnosticsState==='copying'?'正在生成…':diagnosticsState==='copied'?'已复制':'复制诊断信息'}</button></div>
    </div>
  </div>;
}
