import type { CSSProperties } from 'react';
import { Dices, Sparkles } from 'lucide-react';
import wheelCover from '../../assets/games/wheel-cover.svg';
import { BetControls, FairBadge, formatPoints, GameStage } from '../shared/components';
import type { WheelSpin } from './types';

const wheelSegments=[
  {label:'谢谢参与',color:'#ff5f78'},{label:'0.5×',color:'#6f57e8'},{label:'0.8×',color:'#2f8dd8'},{label:'1×',color:'#2ab99f'},{label:'1.2×',color:'#87bc45'},
  {label:'1.5×',color:'#e8af3d'},{label:'2×',color:'#ed7b39'},{label:'3×',color:'#e3529a'},{label:'5×',color:'#9b5de5'},{label:'10×',color:'#ffd95a'},
];

export function WheelGame({spin,wager,setWager,rotation,spinning,busy,onSpin}:{spin?:WheelSpin;wager:number;setWager:(value:number)=>void;rotation:number;spinning:boolean;busy:boolean;onSpin:()=>void}){
  return <GameStage title="幸运大转盘" eyebrow="LUCKY WHEEL" description="选择积分后转动转盘，结果由服务端生成并可通过公开种子复算。" icon={<Dices/>} accent="#ffd85a" art={wheelCover}>
    <div className="wheel-arena"><div className="wheel-halo"/><div className="wheel-pointer"/><div className="lucky-wheel" style={{transform:`rotate(${rotation}deg)`}}>{wheelSegments.map((segment,index)=><span key={segment.label} style={{'--angle':`${index*36+18}deg`} as CSSProperties}>{segment.label}</span>)}<i><b>POIO</b><small>LUCK</small></i></div>
      {spin&&!spinning&&<div className={`wheel-result ${spin.payout>spin.wager?'won':spin.payout?'even':'lost'}`}><Sparkles/><b>{spin.label}</b><span>{spin.payout?`获得 ${formatPoints(spin.payout)} 积分`:'本轮未中奖'}</span></div>}
    </div>
    <div className="game-control-panel wheel-controls"><FairBadge proof={spin?.proof}/><BetControls value={wager} setValue={setWager} disabled={spinning}/><div className="wheel-odds"><span>10 个奖励格</span><b>最高 10×</b><small>仅使用娱乐积分</small></div><button className="primary-game-action wheel-spin-action" disabled={busy||spinning} onClick={onSpin}><Dices/>{spinning?'转动中…':`转动 · ${formatPoints(wager)}`}</button></div>
  </GameStage>;
}
