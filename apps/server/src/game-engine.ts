import { createHash, createHmac, randomBytes } from 'node:crypto';

export type FairSecret = {
  serverSeed:string;
  serverSeedHash:string;
  clientSeed:string;
  nonce:number;
};

export type Card = { rank:string;suit:'spades'|'hearts'|'diamonds'|'clubs' };
export type SlotSymbol = 'duck'|'bolt'|'gem'|'crown'|'star'|'wild'|'scatter';
export type SlotWin = { line:number;symbol:SlotSymbol;count:number;payout:number };

export function createFairSecret(clientSeed:string):FairSecret {
  const serverSeed=randomBytes(32).toString('hex');
  return {serverSeed,serverSeedHash:createHash('sha256').update(serverSeed).digest('hex'),clientSeed,nonce:0};
}

export class FairRandom {
  private block=0;
  private pool=Buffer.alloc(0);
  constructor(private readonly secret:FairSecret){}

  private refill(){
    const bytes=createHmac('sha256',this.secret.serverSeed)
      .update(`${this.secret.clientSeed}:${this.secret.nonce}:${this.block++}`)
      .digest();
    this.pool=Buffer.concat([this.pool,bytes]);
  }

  uint32(){
    while(this.pool.length<4)this.refill();
    const value=this.pool.readUInt32BE(0);
    this.pool=this.pool.subarray(4);
    return value;
  }

  float(){return this.uint32()/0x1_0000_0000;}

  int(maxExclusive:number){
    if(!Number.isSafeInteger(maxExclusive)||maxExclusive<=0)throw new Error('随机范围无效');
    const limit=Math.floor(0x1_0000_0000/maxExclusive)*maxExclusive;
    let value=this.uint32();
    while(value>=limit)value=this.uint32();
    return value%maxExclusive;
  }
}

export function shuffledDeck(random:FairRandom){
  const suits:Card['suit'][]=['spades','hearts','diamonds','clubs'];
  const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck=suits.flatMap(suit=>ranks.map(rank=>({rank,suit})));
  for(let index=deck.length-1;index>0;index--){
    const other=random.int(index+1);
    [deck[index],deck[other]]=[deck[other],deck[index]];
  }
  return deck;
}

export function blackjackScore(cards:Card[]){
  let score=0;let aces=0;
  for(const card of cards){
    if(card.rank==='A'){score+=11;aces++;}
    else if(['K','Q','J'].includes(card.rank))score+=10;
    else score+=Number(card.rank);
  }
  while(score>21&&aces>0){score-=10;aces--;}
  return score;
}

export function isBlackjack(cards:Card[]){return cards.length===2&&blackjackScore(cards)===21;}

function combinations(n:number,k:number){
  if(k<0||k>n)return 0;
  let result=1;
  for(let index=1;index<=Math.min(k,n-k);index++)result=result*(n-index+1)/index;
  return result;
}

export function minesMultiplier(mines:number,revealed:number){
  if(mines<1||mines>20||revealed<0||revealed>25-mines)return 0;
  if(revealed===0)return 1;
  const fair=combinations(25,revealed)/combinations(25-mines,revealed);
  return Math.floor(fair*0.97*100)/100;
}

export const SLOT_PAYLINES:number[][]=[
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
  [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],
];

const slotWeights:Array<[SlotSymbol,number]>=[
  ['duck',30],['bolt',23],['gem',18],['crown',13],['star',8],['wild',5],['scatter',3],
];

const slotPays:Record<Exclude<SlotSymbol,'scatter'>,number[]>={
  duck:[0,0,2,5,14],bolt:[0,0,3,8,20],gem:[0,0,4,11,30],
  crown:[0,0,5,16,50],star:[0,0,8,28,90],wild:[0,0,12,45,150],
};

function weightedSlotSymbol(random:FairRandom){
  const total=slotWeights.reduce((sum,item)=>sum+item[1],0);
  let roll=random.int(total);
  for(const [symbol,weight] of slotWeights){if(roll<weight)return symbol;roll-=weight;}
  return 'duck' as const;
}

function evaluateLine(symbols:SlotSymbol[]){
  const firstReal=symbols.find(symbol=>symbol!=='wild'&&symbol!=='scatter');
  let target:Exclude<SlotSymbol,'scatter'>;
  if(firstReal)target=firstReal as Exclude<SlotSymbol,'wild'|'scatter'>;
  else if(symbols[0]==='wild')target='wild';
  else return undefined;
  let count=0;
  for(const symbol of symbols){
    if(symbol===target||symbol==='wild')count++;else break;
  }
  return count>=3?{symbol:target,count,multiplier:slotPays[target][count-1]}:undefined;
}

export function spinSlots(random:FairRandom,wager:number){
  const grid:Array<[SlotSymbol,SlotSymbol,SlotSymbol]>=Array.from({length:5},()=>[
    weightedSlotSymbol(random),weightedSlotSymbol(random),weightedSlotSymbol(random),
  ]);
  const lineBet=wager/SLOT_PAYLINES.length;
  const wins:SlotWin[]=[];
  SLOT_PAYLINES.forEach((rows,line)=>{
    const result=evaluateLine(rows.map((row,reel)=>grid[reel][row]));
    if(result)wins.push({line,symbol:result.symbol,count:result.count,payout:Math.floor(lineBet*result.multiplier)});
  });
  const scatterCount=grid.flat().filter(symbol=>symbol==='scatter').length;
  const scatterMultiplier=scatterCount>=5?50:scatterCount===4?10:scatterCount===3?2:0;
  const scatterPayout=Math.floor(wager*scatterMultiplier);
  const freeSpinsAwarded=scatterCount>=5?12:scatterCount===4?8:scatterCount===3?5:0;
  const payout=wins.reduce((sum,win)=>sum+win.payout,0)+scatterPayout;
  return {grid,wins,scatterCount,scatterPayout,freeSpinsAwarded,payout};
}

export function crashPoint(secret:FairSecret){
  const hash=createHmac('sha256',secret.serverSeed).update(`${secret.clientSeed}:${secret.nonce}:crash`).digest('hex');
  const value=Number.parseInt(hash.slice(0,13),16)/0x1_0000_0000_0000;
  if(value<0.03)return 1;
  return Math.min(100,Math.max(1.01,Math.floor((0.97/(1-value))*100)/100));
}

export function crashMultiplier(elapsedMs:number){
  return Math.min(100,Math.floor(Math.exp(Math.max(0,elapsedMs)/8_500)*100)/100);
}
