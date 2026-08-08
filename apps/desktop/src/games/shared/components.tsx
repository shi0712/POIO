import type { CSSProperties, ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { FairProof } from './types';

export function formatPoints(value:number){return Math.floor(value).toLocaleString('zh-CN');}
export function formatTime(value:number){return new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}

export function BetControls({value,setValue,disabled,multiple=10}:{value:number;setValue:(value:number)=>void;disabled:boolean;multiple?:number}){
  return <div className="bet-controls"><span>下注积分</span><div><button disabled={disabled} onClick={()=>setValue(Math.max(multiple,Math.floor(value/2/multiple)*multiple))}>½</button><input disabled={disabled} type="number" min={10} max={1_000_000} step={multiple} value={value} onChange={event=>setValue(Math.max(10,Math.min(1_000_000,Number(event.target.value)||10)))}/><button disabled={disabled} onClick={()=>setValue(Math.min(1_000_000,value*2))}>2×</button></div></div>;
}

export function FairBadge({proof}:{proof?:FairProof}){
  if(!proof)return <div className="fair-proof"><ShieldCheck size={14}/>等待新一局公平种子</div>;
  return <div className="fair-proof" title={proof.serverSeedHash}><ShieldCheck size={14}/><span>种子摘要 {proof.serverSeedHash.slice(0,12)}…</span>{proof.serverSeed&&<b>已公开</b>}</div>;
}

export function GameStage({title,eyebrow,description,icon,accent,art,children}:{title:string;eyebrow:string;description:string;icon:ReactNode;accent:string;art:string;children:ReactNode}){
  return <div className="game-stage-page" style={{'--game-accent':accent,'--game-art':`url(${art})`} as CSSProperties}><div className="stage-heading"><div className="stage-icon">{icon}</div><span><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></span></div><div className="stage-content">{children}</div></div>;
}
