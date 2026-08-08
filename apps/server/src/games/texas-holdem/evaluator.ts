import type { Card } from '../../game-engine.js';

export type EvaluatedHand={score:number[];name:string;cards:Card[]};

const rankValue:Record<string,number>={2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14};

function compareScore(left:number[],right:number[]){
  for(let index=0;index<Math.max(left.length,right.length);index++){
    const difference=(left[index]??0)-(right[index]??0);
    if(difference)return difference;
  }
  return 0;
}

function evaluateFive(cards:Card[]):EvaluatedHand{
  const values=cards.map(card=>rankValue[card.rank]).sort((a,b)=>b-a);
  const counts=new Map<number,number>();
  for(const value of values)counts.set(value,(counts.get(value)??0)+1);
  const groups=[...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const flush=cards.every(card=>card.suit===cards[0].suit);
  const unique=[...new Set(values)];
  if(unique[0]===14)unique.push(1);
  let straightHigh=0;
  for(let index=0;index<=unique.length-5;index++)if(unique[index]-unique[index+4]===4){straightHigh=unique[index];break;}
  let score:number[];let name:string;
  if(flush&&straightHigh){score=[8,straightHigh];name=straightHigh===14?'皇家同花顺':'同花顺';}
  else if(groups[0][1]===4){score=[7,groups[0][0],groups[1][0]];name='四条';}
  else if(groups[0][1]===3&&groups[1][1]===2){score=[6,groups[0][0],groups[1][0]];name='葫芦';}
  else if(flush){score=[5,...values];name='同花';}
  else if(straightHigh){score=[4,straightHigh];name='顺子';}
  else if(groups[0][1]===3){score=[3,groups[0][0],...groups.slice(1).map(group=>group[0]).sort((a,b)=>b-a)];name='三条';}
  else if(groups[0][1]===2&&groups[1][1]===2){const pairs=[groups[0][0],groups[1][0]].sort((a,b)=>b-a);score=[2,...pairs,groups[2][0]];name='两对';}
  else if(groups[0][1]===2){score=[1,groups[0][0],...groups.slice(1).map(group=>group[0]).sort((a,b)=>b-a)];name='一对';}
  else{score=[0,...values];name='高牌';}
  return{score,name,cards};
}

export function evaluateTexasHand(cards:Card[]):EvaluatedHand{
  if(cards.length<5||cards.length>7)throw new Error('德州扑克牌数必须为 5 到 7 张');
  let best:EvaluatedHand|undefined;
  for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
    const value=evaluateFive([cards[a],cards[b],cards[c],cards[d],cards[e]]);
    if(!best||compareScore(value.score,best.score)>0)best=value;
  }
  return best!;
}

export function compareTexasHands(left:EvaluatedHand,right:EvaluatedHand){return compareScore(left.score,right.score);}
