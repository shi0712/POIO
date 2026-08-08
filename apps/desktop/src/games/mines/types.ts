import type { FairProof } from '../shared/types';
export type MinesState={id:string;status:'playing'|'won'|'lost';outcome?:string;wager:number;payout:number;mineCount:number;revealed:number[];mines?:number[];multiplier:number;nextPayout:number;proof:FairProof};

