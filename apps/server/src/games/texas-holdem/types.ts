import type { Card, FairSecret } from '../../game-engine.js';

export type TexasRoomStatus='waiting'|'playing'|'finished'|'closed';
export type TexasStreet='waiting'|'preflop'|'flop'|'turn'|'river'|'showdown'|'finished';
export type TexasPlayerStatus='active'|'folded'|'all-in'|'out';

export type TexasPlayerInternal={
  id:string;
  seat:number;
  stack:number;
  status:TexasPlayerStatus;
  streetBet:number;
  totalBet:number;
  hole:Card[];
  joinedAt:number;
};

export type TexasInternalState={
  roomId:string;
  spaceId:string;
  hostUserId:string;
  smallBlind:number;
  bigBlind:number;
  buyIn:number;
  maxPlayers:number;
  status:TexasRoomStatus;
  street:TexasStreet;
  handNumber:number;
  handId?:string;
  players:TexasPlayerInternal[];
  buttonSeat?:number;
  smallBlindSeat?:number;
  bigBlindSeat?:number;
  currentUserId?:string;
  currentBet:number;
  minRaise:number;
  pendingUserIds:string[];
  community:Card[];
  deck:Card[];
  actionDeadline?:number;
  proof?:FairSecret;
  winners:Array<{userId:string;amount:number;handName:string;cards:Card[]}>;
  lastAction?:{userId:string;action:string;amount?:number;at:number};
  createdAt:number;
  updatedAt:number;
};

export type TexasRoomRow={
  id:string;
  spaceId:string;
  hostUserId:string;
  smallBlind:number;
  buyIn:number;
  maxPlayers:number;
  status:TexasRoomStatus;
  stateJson:string;
  createdAt:number;
  updatedAt:number;
};
