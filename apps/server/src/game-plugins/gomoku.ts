import { z } from 'zod';
import { createGomokuRoom, gomokuActiveRoomId, gomokuRooms, gomokuState, joinGomokuRoom, leaveGomokuRoom, playGomokuMove, rematchGomoku, resignGomoku, watchGomokuRoom } from '../games.js';
import { defineGame, encodeGameInvitation } from './sdk.js';

const inviteCooldown=new Map<string,number>();
const RESEND_MS=5_000;

export function clearGomokuInviteCooldown(roomId:string){for(const key of inviteCooldown.keys())if(key.endsWith(`:${roomId}`))inviteCooldown.delete(key);}

export const gomokuPlugin=defineGame({
  manifest:{id:'gomoku',name:'联机五子棋',version:1,mode:'room',description:'社区房间实时对弈',supportsInvites:true},
  register(host){
    host.on('game:gomoku:rooms',(raw,{user,requireSpace})=>{const {spaceId}=z.object({spaceId:z.string()}).parse(raw);requireSpace(spaceId);return gomokuRooms(spaceId,user.id);});
    host.on('game:gomoku:invite',(raw,{user,requireSpace,socketsForUser,createDirectMessage})=>{
      const value=z.object({spaceId:z.string(),roomId:z.string(),targetUserId:z.string()}).parse(raw);
      const members=requireSpace(value.spaceId);const target=members.find(member=>member.id===value.targetUserId);
      if(!target)throw new Error('该用户不在当前社区');if(target.id===user.id)throw new Error('不能邀请自己');
      const state=gomokuState(value.roomId,user.id);
      if(state.spaceId!==value.spaceId)throw new Error('棋局不属于当前社区');
      if(state.status!=='waiting'||state.players.length!==1)throw new Error('该棋局已经开始或没有空位');
      if(!state.players.some(player=>player.id===user.id))throw new Error('只有棋局创建者可以邀请成员');
      if(gomokuActiveRoomId(target.id))throw new Error('对方正在其他五子棋对局中');
      const targetSockets=socketsForUser(target.id);if(targetSockets.length===0)throw new Error('该成员当前不在线');
      const key=`${user.id}:${target.id}:${state.roomId}`,now=Date.now();
      if((inviteCooldown.get(key)??0)>now)throw new Error('邀请已发送，请稍后再试');
      const canResendAt=now+RESEND_MS;inviteCooldown.set(key,canResendAt);
      const invitation={spaceId:value.spaceId,roomId:state.roomId,wager:state.wager,pot:state.wager*2,inviter:user,expiresAt:now+60_000};
      const message=createDirectMessage(user,target.id,encodeGameInvitation({gameId:'gomoku',spaceId:invitation.spaceId,roomId:invitation.roomId,title:'五子棋对局邀请',wager:invitation.wager,pot:invitation.pot,expiresAt:invitation.expiresAt}));
      for(const userId of [user.id,target.id])for(const connected of socketsForUser(userId))connected.emit('dm:message',message);
      for(const connected of targetSockets)connected.emit('game:gomoku:invited',invitation);
      return {canResendAt,invitation,message};
    });
    host.on('game:gomoku:create',(raw,{socket,user,requireSpace})=>{const value=z.object({spaceId:z.string(),wager:z.number().int()}).parse(raw);requireSpace(value.spaceId);const state=createGomokuRoom(value.spaceId,user.id,value.wager);socket.join(`gomoku:${state.roomId}`);return state;});
    host.on('game:gomoku:join',(raw,{socket,user,requireSpace})=>{const value=z.object({spaceId:z.string(),roomId:z.string()}).parse(raw);requireSpace(value.spaceId);const state=joinGomokuRoom(value.roomId,value.spaceId,user.id);socket.join(`gomoku:${state.roomId}`);return state;});
    host.on('game:gomoku:watch',(raw,{socket,user,requireSpace})=>{const value=z.object({spaceId:z.string(),roomId:z.string()}).parse(raw);requireSpace(value.spaceId);const state=watchGomokuRoom(value.roomId,value.spaceId,user.id);socket.join(`gomoku:${state.roomId}`);return state;});
    host.on('game:gomoku:move',(raw,{user,requireSpace})=>{const value=z.object({roomId:z.string(),cell:z.number().int().min(0).max(224)}).parse(raw);const state=playGomokuMove(value.roomId,user.id,value.cell);requireSpace(state.spaceId);return state;});
    host.on('game:gomoku:resign',(raw,{user,requireSpace})=>{const state=resignGomoku(z.object({roomId:z.string()}).parse(raw).roomId,user.id);requireSpace(state.spaceId);return state;});
    host.on('game:gomoku:rematch',(raw,{user,requireSpace})=>{const state=rematchGomoku(z.object({roomId:z.string()}).parse(raw).roomId,user.id);requireSpace(state.spaceId);return state;});
    host.on('game:gomoku:leave',(raw,{socket,user})=>{const {roomId}=z.object({roomId:z.string()}).parse(raw);leaveGomokuRoom(roomId,user.id);socket.leave(`gomoku:${roomId}`);return true;});
  },
});
