export type TexasCard={rank:string;suit:'spades'|'hearts'|'diamonds'|'clubs'};
export type TexasPlayer={id:string;username:string;avatarUrl?:string;seat:number;stack:number;status:'active'|'folded'|'all-in'|'out';streetBet:number;totalBet:number;hole:TexasCard[];cardsHidden:number;isHost:boolean;isDealer:boolean;blind?:'small'|'big'};
export type TexasWinner={userId:string;amount:number;handName:string;cards:TexasCard[]};
export type TexasRoom={roomId:string;status:'waiting'|'playing'|'finished';smallBlind:number;bigBlind:number;buyIn:number;maxPlayers:number;players:Array<Pick<TexasPlayer,'id'|'username'|'avatarUrl'|'seat'|'stack'>>;handNumber:number;pot:number;updatedAt:number;isMine:boolean};
export type TexasState={
  roomId:string;spaceId:string;hostUserId:string;smallBlind:number;bigBlind:number;buyIn:number;maxPlayers:number;status:'waiting'|'playing'|'finished';street:'waiting'|'preflop'|'flop'|'turn'|'river'|'showdown'|'finished';handNumber:number;handId?:string;
  buttonSeat?:number;smallBlindSeat?:number;bigBlindSeat?:number;currentUserId?:string;currentBet:number;minRaise:number;pot:number;community:TexasCard[];actionDeadline?:number;winners:TexasWinner[];lastAction?:{userId:string;action:string;amount?:number;at:number};
  proof?:{serverSeedHash:string;clientSeed:string;nonce:number;serverSeed?:string};players:TexasPlayer[];me:{seat:number;stack:number;status:string}|'spectator';canAct:boolean;toCall:number;minRaiseTo:number;canStart:boolean;createdAt:number;updatedAt:number;
};
