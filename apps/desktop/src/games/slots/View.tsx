import { Crown, Gift, Play } from 'lucide-react';
import slotsCover from '../../assets/games/slots-cover.png';
import { BetControls, FairBadge, formatPoints, GameStage } from '../shared/components';
import type { Wallet } from '../shared/types';
import type { SlotSpin, SlotSymbol } from './types';

const symbolMeta:Record<SlotSymbol,{className:string}>={duck:{className:'duck'},bolt:{className:'bolt'},gem:{className:'gem'},crown:{className:'crown'},star:{className:'star'},wild:{className:'wild'},scatter:{className:'scatter'}};

export function SlotsGame({spin,wallet,wager,setWager,spinning,busy,onSpin}:{spin?:SlotSpin;wallet:Wallet;wager:number;setWager:(v:number)=>void;spinning:boolean;busy:boolean;onSpin:(free?:boolean)=>void}){
  const grid=spin?.grid??Array.from({length:5},()=>['duck','gem','bolt'] as SlotSymbol[]);const winning=new Set(spin?.wins.map(win=>win.line)??[]);
  return <GameStage title="霓虹转轴" eyebrow="POIO SLOTS" description="5×3 转轴、10 条中奖线，Wild 可替代普通符号，Scatter 触发免费旋转。" icon={<Crown/>} accent="#ff75bc" art={slotsCover}>
    <div className="slots-machine"><div className="machine-lights">{Array.from({length:13},(_,index)=><i key={index}/>)}</div><div className={`slot-reels ${spinning?'spinning':''}`}>{grid.map((reel,reelIndex)=><div className="slot-reel" key={reelIndex}>{reel.map((symbol,row)=><SlotTile symbol={symbol} key={`${reelIndex}-${row}-${symbol}`}/>)}</div>)}</div><div className="slot-lines">{Array.from({length:10},(_,index)=><i key={index} className={winning.has(index)?'win':''}/>)}</div><div className={`slot-win-panel ${spin?.payout?'win':''}`}><span>{spin?.freeSpin?'免费旋转':'上一局结果'}</span><b>{spin?spin.payout?`+${formatPoints(spin.payout)}`:'未中奖':'等待旋转'}</b><small>{spin?.freeSpinsAwarded?`获得 ${spin.freeSpinsAwarded} 次免费旋转`:spin?.scatterCount?`${spin.scatterCount} 个 Scatter`:spin?.wins.length?`${spin.wins.length} 条中奖线`:'3 个相同符号从左侧连起即可中奖'}</small></div></div>
    <div className="game-control-panel"><FairBadge proof={spin?.proof}/><BetControls value={wager} setValue={setWager} disabled={spinning}/><div className="free-spin-count"><Gift/><span><b>{wallet.freeSpins}</b><small>免费旋转</small></span></div><button className="primary-game-action slot-spin-button" disabled={busy||spinning} onClick={()=>onSpin(wallet.freeSpins>0)}><Play fill="currentColor"/>{wallet.freeSpins>0?'免费旋转':'旋转'}</button></div>
  </GameStage>;
}

function SlotTile({symbol}:{symbol:SlotSymbol}){const meta=symbolMeta[symbol];return <div className={`slot-symbol ${meta.className}`}><SlotGlyph symbol={symbol}/><small>{symbol==='scatter'?'BONUS':symbol==='wild'?'WILD':''}</small></div>}
function SlotGlyph({symbol}:{symbol:SlotSymbol}){
  if(symbol==='wild')return <strong>W</strong>;
  if(symbol==='scatter')return <svg viewBox="0 0 48 48" aria-hidden><path d="M24 4l4.7 12.2L42 17l-10.3 8.2L35 39l-11-7.3L13 39l3.3-13.8L6 17l13.3-.8L24 4z"/></svg>;
  if(symbol==='gem')return <svg viewBox="0 0 48 48" aria-hidden><path d="M11 17l8-9h10l8 9-13 24L11 17z"/><path d="M11 17h26M19 8l5 9 5-9M24 17v24"/></svg>;
  if(symbol==='bolt')return <svg viewBox="0 0 48 48" aria-hidden><path d="M28 3L10 27h12l-2 18 18-26H26l2-16z"/></svg>;
  if(symbol==='crown')return <svg viewBox="0 0 48 48" aria-hidden><path d="M7 15l10 8 7-14 7 14 10-8-4 23H11L7 15z"/><path d="M12 32h25"/></svg>;
  if(symbol==='star')return <svg viewBox="0 0 48 48" aria-hidden><path d="M24 5l5.5 12 13 1.5-9.6 9 2.7 13L24 34 12.4 40.5l2.7-13-9.6-9 13-1.5L24 5z"/></svg>;
  return <svg className="duck-glyph" viewBox="0 0 48 48" aria-hidden><circle cx="25" cy="26" r="14"/><circle cx="18" cy="17" r="9"/><path d="M8 18l7-4v8l-7-4zM22 32c6 3 11 2 15-2"/><circle className="duck-eye" cx="18" cy="15" r="1.5"/></svg>;
}
