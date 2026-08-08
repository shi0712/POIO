import type { FairProof } from '../shared/types';
export type CardData={rank?:string;suit?:'spades'|'hearts'|'diamonds'|'clubs';hidden?:boolean};
export type BlackjackState={id:string;status:'playing'|'won'|'lost'|'push';outcome?:string;wager:number;payout:number;player:CardData[];dealer:CardData[];playerScore:number;dealerScore?:number;canDouble:boolean;proof:FairProof};

