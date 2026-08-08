import { useMemo } from 'react';
import { Coins, Rocket } from 'lucide-react';
import crashCover from '../../assets/games/crash-cover.png';
import { BetControls, FairBadge, formatPoints, GameStage } from '../shared/components';
import type { CrashState } from './types';

export function CrashGame({state,trace,wager,setWager,busy,onBet,onCashout}:{state:CrashState;trace:number[];wager:number;setWager:(v:number)=>void;busy:boolean;onBet:()=>void;onCashout:()=>void}){
  const path=useMemo(()=>{const values=trace.length>1?trace:[1,1];const max=Math.max(2,...values);return values.map((value,index)=>`${20+(index/(values.length-1))*660},${280-(Math.log(value)/Math.log(max))*230}`).join(' ')},[trace]);
  const countdown=Math.max(0,(state.bettingEndsAt-Date.now())/1000);
  return <GameStage title="Crash" eyebrow="COMMUNITY FLIGHT" description="与当前社区共享同一条倍率曲线，在火箭爆点前结算。" icon={<Rocket/>} accent="#d5ff58" art={crashCover}>
    <div className={`crash-stage ${state.phase}`}><div className="crash-grid"/><svg viewBox="0 0 700 310" preserveAspectRatio="none"><defs><linearGradient id="crashLine" x1="0" x2="1"><stop offset="0" stopColor="#7654ff"/><stop offset="1" stopColor="#d5ff58"/></linearGradient></defs><polyline points={path} fill="none" stroke="url(#crashLine)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <div className="crash-readout"><Rocket/><b>{state.phase==='betting'?countdown.toFixed(1):state.multiplier.toFixed(2)}<small>{state.phase==='betting'?'s':'×'}</small></b><span>{state.phase==='betting'?'等待下注':state.phase==='running'?'火箭正在加速':'本轮已爆点'}</span></div>
      <div className="crash-players">{state.bets.length===0?<span>本轮还没有人下注</span>:state.bets.slice(0,8).map(bet=><div key={bet.userId} className={bet.status}><i>{bet.username.slice(0,1).toUpperCase()}</i><span><b>{bet.username}</b><small>{formatPoints(bet.wager)}</small></span><strong>{bet.status==='cashed'?`${bet.cashoutMultiplier?.toFixed(2)}×`:bet.status==='lost'?'爆点':'飞行中'}</strong></div>)}</div>
    </div>
    <div className="game-control-panel"><FairBadge proof={state.proof}/><BetControls value={wager} setValue={setWager} disabled={state.phase!=='betting'||!!state.myBet}/>{state.phase==='betting'?<button className="primary-game-action" disabled={busy||!!state.myBet} onClick={onBet}><Rocket/>{state.myBet?'已下注':'加入本轮'}</button>:state.phase==='running'&&state.myBet?.status==='playing'?<button className="primary-game-action cash" disabled={busy} onClick={onCashout}><Coins/>结算 {formatPoints(state.myBet.wager*state.multiplier)}</button>:<button className="primary-game-action" disabled>{state.phase==='crashed'?'等待下一轮':'观看本轮'}</button>}</div>
  </GameStage>;
}

