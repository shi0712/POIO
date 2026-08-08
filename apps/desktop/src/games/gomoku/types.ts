export type GomokuColor='black'|'white';
export type GomokuPlayer={id:string;username:string;avatarUrl?:string;color:GomokuColor};
export type GomokuRoom={roomId:string;status:'waiting'|'playing'|'finished';wager:number;pot:number;players:GomokuPlayer[];moveCount:number;roundNumber:number;winnerId?:string;updatedAt:number;isMine:boolean};
export type GomokuState={roomId:string;spaceId:string;wager:number;pot:number;status:'waiting'|'playing'|'finished';board:Array<GomokuColor|null>;currentColor:GomokuColor;turnUserId?:string;winnerId?:string;result?:'five'|'draw'|'resign';winningLine:number[];lastMove?:number;rematchVotes:string[];roundNumber:number;players:GomokuPlayer[];me:GomokuColor|'spectator';canMove:boolean;createdAt:number;updatedAt:number};

