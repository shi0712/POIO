import type { FairProof } from '../shared/types';
export type CrashBet={userId:string;username:string;wager:number;status:'playing'|'cashed'|'lost';cashoutMultiplier?:number;payout:number};
export type CrashState={spaceId:string;roundId:string;phase:'betting'|'running'|'crashed';multiplier:number;bettingEndsAt:number;startedAt?:number;endedAt?:number;bets:CrashBet[];myBet?:CrashBet;proof:FairProof};

