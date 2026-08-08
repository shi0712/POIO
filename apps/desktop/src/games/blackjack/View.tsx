import type { CSSProperties } from 'react';
import { Dices, Sparkles, Spade } from 'lucide-react';
import blackjackCover from '../../assets/games/blackjack-cover.png';
import { BetControls, FairBadge, formatPoints, GameStage } from '../shared/components';
import type { BlackjackState, CardData } from './types';

export function BlackjackGame({state,wager,setWager,busy,onStart,onAction}:{state?:BlackjackState;wager:number;setWager:(v:number)=>void;busy:boolean;onStart:()=>void;onAction:(action:'hit'|'stand'|'double')=>void}){
  const playing=state?.status==='playing';
  return <GameStage title="21 点" eyebrow="BLACKJACK" description="尽量接近 21 点，但不要爆牌。庄家 17 点停牌。" icon={<Spade/>} accent="#9d7cff" art={blackjackCover}>
    <div className="blackjack-table">
      <div className="table-glow"/><div className="table-hand dealer"><label>DEALER {state?.dealerScore!==undefined&&<b>{state.dealerScore}</b>}</label><CardHand cards={state?.dealer??[]}/></div>
      {state&&state.status!=='playing'&&<div className={`game-result ${state.status}`}><Sparkles/><b>{state.outcome}</b><span>{state.payout>0?`获得 ${formatPoints(state.payout)} 积分`:'再来一局扳回来'}</span></div>}
      <div className="table-hand player"><label>YOU {state&&<b>{state.playerScore}</b>}</label><CardHand cards={state?.player??[]}/></div>
    </div>
    <div className="game-control-panel"><FairBadge proof={state?.proof}/><BetControls value={wager} setValue={setWager} disabled={!!playing}/>{!playing?<button className="primary-game-action" disabled={busy} onClick={onStart}><Dices/>发牌</button>:<div className="blackjack-actions"><button disabled={busy} onClick={()=>onAction('hit')}>要牌</button><button disabled={busy} onClick={()=>onAction('stand')}>停牌</button><button disabled={busy||!state.canDouble} onClick={()=>onAction('double')}>加倍</button></div>}</div>
  </GameStage>;
}

function CardHand({cards}:{cards:CardData[]}){return <div className="card-hand">{cards.length?cards.map((card,index)=><PlayingCard card={card} index={index} key={`${card.rank}-${card.suit}-${index}`}/>):<><div className="empty-card"/><div className="empty-card"/></>}</div>}
function PlayingCard({card,index}:{card:CardData;index:number}){
  const tilt=`${Math.max(-6,Math.min(6,(index-1.5)*2.5))}deg`;
  if(card.hidden)return <div className="playing-card back" style={{'--card-tilt':tilt} as CSSProperties}><i/></div>;
  const symbol=card.suit==='spades'?'♠':card.suit==='hearts'?'♥':card.suit==='diamonds'?'♦':'♣';const red=card.suit==='hearts'||card.suit==='diamonds';
  return <div className={`playing-card ${red?'red':'black'}`} style={{'--card-tilt':tilt} as CSSProperties}><span><b>{card.rank}</b>{symbol}</span><i>{symbol}</i></div>;
}

