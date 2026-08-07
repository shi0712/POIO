import type { Socket } from 'socket.io';
import type { PublicUser } from '../database.js';

export type GameAck=(response:{ok:true;value:unknown}|{ok:false;error:string})=>void;

export type GameManifest={
  id:string;
  name:string;
  version:number;
  mode:'solo'|'space'|'room';
  description:string;
  supportsInvites?:boolean;
};

export type GameRoomDescriptor={gameId:string;spaceId:string;roomId:string;status:'waiting'|'playing'|'finished';capacity:number;playerIds:string[];wager?:number};
export type GameInvitationEnvelope={gameId:string;spaceId:string;roomId:string;title:string;wager?:number;pot?:number;expiresAt:number;metadata?:Record<string,unknown>};
export const encodeGameInvitation=(invitation:GameInvitationEnvelope)=>`[[POIO:GAME:INVITE:1]]|${Buffer.from(JSON.stringify(invitation),'utf8').toString('base64url')}`;

export type GameRequestContext={
  socket:Socket;
  user:PublicUser;
  requireSpace:(spaceId:string)=>PublicUser[];
  socketsForUser:(userId:string)=>Socket[];
  createDirectMessage:(sender:PublicUser,peerId:string,body:string)=>unknown;
};

export type GameHandler=(raw:unknown,context:GameRequestContext)=>unknown|Promise<unknown>;

export interface GamePluginHost {
  on:(event:string,handler:GameHandler)=>void;
}

export interface GamePlugin {
  manifest:GameManifest;
  register:(host:GamePluginHost)=>void;
}

export function defineGame(plugin:GamePlugin){return plugin;}
