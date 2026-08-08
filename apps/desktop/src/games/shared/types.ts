export type Wallet={balance:number;lastDaily:number;nextDailyAt:number;dailyReward:number;freeSpins:number;freeWager:number};
export type FairProof={serverSeedHash:string;clientSeed:string;nonce:number;serverSeed?:string;crashAt?:number};
export type GameInviteMember={id:string;username:string;avatarUrl?:string};
export type LedgerEntry={id:string;amount:number;balanceAfter:number;kind:string;game?:string;roundId?:string;createdAt:number};
export type GameRound={id:string;game:string;wager:number;payout:number;outcome:string;createdAt:number;completedAt:number};

