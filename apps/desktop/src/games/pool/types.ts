export type PoolGroup='solids'|'stripes';
export type PoolPlayer={id:string;username:string;avatarUrl?:string;seat:0|1;group?:PoolGroup};
export type PoolBall={number:number;x:number;y:number;pocketed:boolean};
export type PoolFrame={balls:PoolBall[]};
export type PoolRoom={roomId:string;status:'waiting'|'playing'|'finished';wager:number;pot:number;players:PoolPlayer[];roundNumber:number;winnerId?:string;updatedAt:number;isMine:boolean};
export type PoolState={roomId:string;spaceId:string;wager:number;pot:number;status:'waiting'|'playing'|'finished';players:PoolPlayer[];balls:PoolBall[];currentUserId?:string;ballInHand:boolean;openTable:boolean;breakShot:boolean;shotNumber:number;lastShot?:{id:string;shooterId:string;frames:PoolFrame[];pocketed:number[];foul:boolean;message:string};winnerId?:string;result?:string;roundNumber:number;rematchVotes:string[];meSeat?:0|1;canShoot:boolean;canPlace:boolean;createdAt:number;updatedAt:number};
