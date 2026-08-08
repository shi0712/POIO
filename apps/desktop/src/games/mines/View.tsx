import { Bomb, Coins, Pickaxe, Sparkles } from 'lucide-react';
import minesCover from '../../assets/games/mines-cover.png';
import { BetControls, FairBadge, formatPoints, GameStage } from '../shared/components';
import type { MinesState } from './types';

export function MinesGame({state,wager,setWager,mineCount,setMineCount,busy,onStart,onReveal,onCashout}:{state?:MinesState;wager:number;setWager:(v:number)=>void;mineCount:number;setMineCount:(v:number)=>void;busy:boolean;onStart:()=>void;onReveal:(cell:number)=>void;onCashout:()=>void}){
  const playing=state?.status==='playing';const revealed=new Set(state?.revealed??[]);const mines=new Set(state?.mines??[]);
  return <GameStage title="Mines" eyebrow="CRYSTAL FIELD" description="每翻开一个安全水晶，倍率都会上涨。踩雷前随时结算。" icon={<Pickaxe/>} accent="#42dfce" art={minesCover}>
    <div className="mines-board-wrap"><div className="mines-grid">{Array.from({length:25},(_,cell)=>{const open=revealed.has(cell);const mine=mines.has(cell);return <button key={cell} disabled={!playing||busy||open} className={`mine-cell ${open&&!mine?'safe':''} ${mine?'mine':''}`} onClick={()=>onReveal(cell)}>{mine?<Bomb/>:open?<i className="crystal-gem"/>:<small>{cell+1}</small>}</button>})}</div>{state&&state.status!=='playing'&&<div className={`game-result ${state.status}`}><Sparkles/><b>{state.outcome}</b><span>{state.payout?`+${formatPoints(state.payout)} 积分`:'本局未获得积分'}</span></div>}</div>
    <div className="game-control-panel"><FairBadge proof={state?.proof}/><BetControls value={wager} setValue={setWager} disabled={!!playing}/><div className="mine-settings"><span>地雷数量</span><div className="mine-counts">{[3,5,8,12].map(value=><button key={value} disabled={!!playing} className={mineCount===value?'active':''} onClick={()=>setMineCount(value)}>{value}</button>)}</div></div><div className="mine-stats"><div><small>当前倍率</small><b>{(state?.multiplier??1).toFixed(2)}×</b></div><div><small>安全格</small><b>{state?.revealed.length??0}/{25-(state?.mineCount??mineCount)}</b></div></div>{!playing?<button className="primary-game-action" disabled={busy} onClick={onStart}><Bomb/>开始</button>:<button className="primary-game-action cash" disabled={busy||state.revealed.length===0} onClick={onCashout}><Coins/>结算 {formatPoints(state.nextPayout)}</button>}</div>
  </GameStage>;
}
