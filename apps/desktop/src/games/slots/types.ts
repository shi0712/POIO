import type { FairProof } from '../shared/types';
export type SlotSymbol='duck'|'bolt'|'gem'|'crown'|'star'|'wild'|'scatter';
export type SlotSpin={id:string;wager:number;freeSpin:boolean;grid:SlotSymbol[][];wins:Array<{line:number;symbol:SlotSymbol;count:number;payout:number}>;scatterCount:number;scatterPayout:number;freeSpinsAwarded:number;payout:number;proof:FairProof};

