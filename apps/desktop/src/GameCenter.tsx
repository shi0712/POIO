import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Check, Coins, Gift, History, Play, ShieldCheck, Swords, Volume2, X } from 'lucide-react';
import { request, socket } from './api';
import gameHero from './assets/games/poio-game-center-hero.png';
import './games.css';
import { desktopGames as games, type DesktopGameId } from './game-plugins/registry';
import { moveBlackjack, startBlackjack } from './games/blackjack/api';
import { BlackjackGame } from './games/blackjack/View';
import type { BlackjackState } from './games/blackjack/types';
import { cashoutCrash, placeCrashBet } from './games/crash/api';
import { CrashGame } from './games/crash/View';
import type { CrashState } from './games/crash/types';
import { createGomokuRoom, inviteGomokuMember, joinGomoku, leaveGomoku, moveGomoku, openGomokuRoom, rematchGomoku, resignGomoku } from './games/gomoku/api';
import { GomokuGame, GomokuInvitePicker } from './games/gomoku/View';
import type { GomokuRoom, GomokuState } from './games/gomoku/types';
import { cashoutMines, revealMinesCell, startMines } from './games/mines/api';
import { MinesGame } from './games/mines/View';
import type { MinesState } from './games/mines/types';
import { spinSlots } from './games/slots/api';
import { SlotsGame } from './games/slots/View';
import type { SlotSpin } from './games/slots/types';
import { spinWheel } from './games/wheel/api';
import { WheelGame } from './games/wheel/View';
import type { WheelSpin } from './games/wheel/types';
import { formatPoints, formatTime } from './games/shared/components';
import type { GameInviteMember, GameRound, LedgerEntry, Wallet } from './games/shared/types';

type GameId='lobby'|DesktopGameId;
type Overview={wallet:Wallet;ledger:LedgerEntry[];history:GameRound[];blackjack?:BlackjackState;mines?:MinesState;slots:{freeSpins:number;freeWager:number};wheel?:WheelSpin;crash?:CrashState;gomokuRooms:GomokuRoom[]};

let audioContext:AudioContext|undefined;
function playGameSound(kind:'tap'|'win'|'lose'|'spin'|'cash'){
  try{
    audioContext??=new AudioContext();const now=audioContext.currentTime;
    const notes=kind==='win'?[523,659,784]:kind==='lose'?[220,174]:kind==='spin'?[240,320,420]:kind==='cash'?[660,880]:[420];
    notes.forEach((frequency,index)=>{
      const oscillator=audioContext!.createOscillator();const gain=audioContext!.createGain();
      oscillator.type=kind==='lose'?'sawtooth':'sine';oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(0,now+index*.07);gain.gain.linearRampToValueAtTime(.08,now+index*.07+.01);gain.gain.exponentialRampToValueAtTime(.001,now+index*.07+.16);
      oscillator.connect(gain).connect(audioContext!.destination);oscillator.start(now+index*.07);oscillator.stop(now+index*.07+.18);
    });
  }catch{}
}

export default function GameCenter({spaceId,spaceName,onlineMembers,joinRoomId,onJoinRoomHandled,onClose,onError}:{spaceId:string;spaceName:string;onlineMembers:GameInviteMember[];joinRoomId?:string;onJoinRoomHandled:()=>void;onClose:()=>void;onError:(error:unknown)=>void}){
  const [active,setActive]=useState<GameId>('lobby');const [overview,setOverview]=useState<Overview>();const [loading,setLoading]=useState(true);
  const [historyOpen,setHistoryOpen]=useState(false);const [soundEnabled,setSoundEnabled]=useState(true);
  const [blackjackBet,setBlackjackBet]=useState(100);const [minesBet,setMinesBet]=useState(100);const [mineCount,setMineCount]=useState(5);const [slotBet,setSlotBet]=useState(100);const [wheelBet,setWheelBet]=useState(100);const [crashBet,setCrashBet]=useState(100);const [gomokuBet,setGomokuBet]=useState(100);
  const [busy,setBusy]=useState(false);const [slotSpin,setSlotSpin]=useState<SlotSpin>();const [spinning,setSpinning]=useState(false);const [wheelSpin,setWheelSpin]=useState<WheelSpin>();const [wheelSpinning,setWheelSpinning]=useState(false);const [wheelRotation,setWheelRotation]=useState(0);const [crashTrace,setCrashTrace]=useState<number[]>([1]);
  const [gomoku,setGomoku]=useState<GomokuState>();
  const [gomokuInviteOpen,setGomokuInviteOpen]=useState(false);const [gomokuInviteBusy,setGomokuInviteBusy]=useState('');const [gomokuInvited,setGomokuInvited]=useState<Record<string,number>>({});const [gomokuInviteClock,setGomokuInviteClock]=useState(Date.now());
  const crashRound=useRef('');
  const wallet=overview?.wallet;

  const applyResponse=(value:{wallet:Wallet;state?:BlackjackState|MinesState;spin?:SlotSpin},game:'blackjack'|'mines'|'slots')=>{
    setOverview(current=>current?{...current,wallet:value.wallet,
      ...(game==='blackjack'?{blackjack:value.state as BlackjackState}:{}),
      ...(game==='mines'?{mines:value.state as MinesState}:{}),
      ...(game==='slots'?{slots:{freeSpins:value.wallet.freeSpins,freeWager:value.wallet.freeWager}}:{})}:current);
    if(value.spin)setSlotSpin(value.spin);
  };

  useEffect(()=>{
    let disposed=false;setLoading(true);
    request<Overview>('game:enter',{spaceId}).then(value=>{if(!disposed){setOverview(value);setWheelSpin(value.wheel);setLoading(false)}}).catch(error=>{if(!disposed){setLoading(false);onError(error)}});
    const walletUpdate=(next:Wallet)=>setOverview(current=>current?{...current,wallet:next,slots:{freeSpins:next.freeSpins,freeWager:next.freeWager}}:current);
    const crashUpdate=(next:CrashState)=>setOverview(current=>current?{...current,crash:next}:current);
    const gomokuRoomsUpdate=(rooms:GomokuRoom[])=>setOverview(current=>current?{...current,gomokuRooms:rooms}:current);
    const gomokuStateUpdate=(state:GomokuState)=>setGomoku(current=>!current||current.roomId===state.roomId?state:current);
    const gomokuClosed=({roomId}:{roomId:string})=>{setGomoku(current=>current?.roomId===roomId?undefined:current);setOverview(current=>current?{...current,gomokuRooms:current.gomokuRooms.filter(room=>room.roomId!==roomId)}:current)};
    socket.on('game:wallet',walletUpdate);socket.on('game:crash',crashUpdate);socket.on('game:gomoku:rooms',gomokuRoomsUpdate);socket.on('game:gomoku:state',gomokuStateUpdate);socket.on('game:gomoku:closed',gomokuClosed);
    return()=>{disposed=true;socket.off('game:wallet',walletUpdate);socket.off('game:crash',crashUpdate);socket.off('game:gomoku:rooms',gomokuRoomsUpdate);socket.off('game:gomoku:state',gomokuStateUpdate);socket.off('game:gomoku:closed',gomokuClosed);void request('game:leave').catch(()=>{})};
  },[spaceId]);

  useEffect(()=>{setGomokuInvited({});setGomokuInviteOpen(false)},[gomoku?.roomId]);
  useEffect(()=>{if(!gomokuInviteOpen)return;setGomokuInviteClock(Date.now());const timer=window.setInterval(()=>setGomokuInviteClock(Date.now()),500);return()=>window.clearInterval(timer)},[gomokuInviteOpen]);

  useEffect(()=>{
    if(!joinRoomId)return;
    let disposed=false;setActive('gomoku');setBusy(true);
    joinGomoku(spaceId,joinRoomId).then(state=>{if(!disposed){setGomoku(state);soundEnabled&&playGameSound('tap')}}).catch(error=>{if(!disposed)onError(error)}).finally(()=>{if(!disposed){setBusy(false);onJoinRoomHandled()}});
    return()=>{disposed=true};
  },[joinRoomId,spaceId]);

  useEffect(()=>{
    const crash=overview?.crash;if(!crash)return;
    if(crashRound.current!==crash.roundId){crashRound.current=crash.roundId;setCrashTrace([1]);return;}
    if(crash.phase==='running')setCrashTrace(current=>[...current,crash.multiplier].slice(-160));
  },[overview?.crash]);

  useEffect(()=>{
    if(active!=='crash'||overview?.crash?.phase!=='betting')return;
    const timer=window.setInterval(()=>setCrashTrace(current=>[...current]),100);
    return()=>window.clearInterval(timer);
  },[active,overview?.crash?.phase,overview?.crash?.roundId]);

  const act=async<T,>(operation:()=>Promise<T>,apply:(result:T)=>void)=>{
    if(busy)return;setBusy(true);
    try{const result=await operation();apply(result);}
    catch(error){onError(error);}finally{setBusy(false)}
  };
  const sound=(kind:Parameters<typeof playGameSound>[0])=>{if(soundEnabled)playGameSound(kind)};

  const claimDaily=()=>void act(()=>request<Wallet>('game:daily'),next=>{setOverview(current=>current?{...current,wallet:next}:current);sound('win')});
  const startBlackjackGame=()=>void act(()=>startBlackjack(blackjackBet),value=>{applyResponse(value,'blackjack');sound('tap')});
  const blackjackMove=(action:'hit'|'stand'|'double')=>void act(()=>moveBlackjack(action),value=>{applyResponse(value,'blackjack');sound(value.state.status==='won'?'win':value.state.status==='lost'?'lose':'tap')});
  const startMinesGame=()=>void act(()=>startMines(minesBet,mineCount),value=>{applyResponse(value,'mines');sound('tap')});
  const revealCell=(cell:number)=>void act(()=>revealMinesCell(cell),value=>{applyResponse(value,'mines');sound(value.state.status==='lost'?'lose':value.state.status==='won'?'win':'tap')});
  const cashMines=()=>void act(()=>cashoutMines(),value=>{applyResponse(value,'mines');sound('cash')});
  const spin=async(useFreeSpin=false)=>{
    if(busy||spinning)return;setBusy(true);setSpinning(true);sound('spin');
    try{
      const value=await spinSlots(slotBet,useFreeSpin);
      await new Promise(resolve=>window.setTimeout(resolve,950));applyResponse(value,'slots');sound(value.spin.payout>0?'win':'tap');
    }catch(error){onError(error)}finally{setBusy(false);setSpinning(false)}
  };
  const spinWheelGame=async()=>{
    if(busy||wheelSpinning)return;setBusy(true);setWheelSpinning(true);sound('spin');
    try{
      const value=await spinWheel(wheelBet);
      const turns=5+Math.floor(Math.random()*2),center=value.spin.segmentIndex*36+18;
      setWheelRotation(current=>current+turns*360+(360-(center+current%360))%360);
      await new Promise(resolve=>window.setTimeout(resolve,2800));setWheelSpin(value.spin);setOverview(current=>current?{...current,wallet:value.wallet,wheel:value.spin}:current);sound(value.spin.payout>value.spin.wager?'win':value.spin.payout?'tap':'lose');
    }catch(error){onError(error)}finally{setBusy(false);setWheelSpinning(false)}
  };
  const placeCrash=()=>void act(()=>placeCrashBet(spaceId,crashBet),value=>{setOverview(current=>current?{...current,wallet:value.wallet,crash:value.state}:current);sound('tap')});
  const cashCrash=()=>void act(()=>cashoutCrash(spaceId),value=>{setOverview(current=>current?{...current,wallet:value.wallet,crash:value.state}:current);sound('cash')});
  const applyGomoku=(state:GomokuState)=>{setGomoku(state);sound(state.status==='finished'?(state.winnerId&&state.players.find(player=>player.color===state.me)?.id===state.winnerId?'win':'lose'):'tap')};
  const createGomoku=()=>void act(()=>createGomokuRoom(spaceId,gomokuBet),applyGomoku);
  const openGomoku=(room:GomokuRoom)=>void act(()=>openGomokuRoom(spaceId,room),applyGomoku);
  const gomokuMove=(cell:number)=>void act(()=>moveGomoku(gomoku!.roomId,cell),applyGomoku);
  const gomokuResign=()=>void act(()=>resignGomoku(gomoku!.roomId),applyGomoku);
  const gomokuRematch=()=>void act(()=>rematchGomoku(gomoku!.roomId),applyGomoku);
  const gomokuLeave=()=>void act(()=>leaveGomoku(gomoku!.roomId),()=>{setGomoku(undefined);sound('tap')});
  const inviteGomoku=async(member:GameInviteMember)=>{
    if(!gomoku||gomokuInviteBusy)return;setGomokuInviteBusy(member.id);
    try{const value=await inviteGomokuMember(spaceId,gomoku.roomId,member.id);setGomokuInvited(current=>({...current,[member.id]:value.canResendAt}));}
    catch(error){onError(error)}finally{setGomokuInviteBusy('')}
  };

  if(loading)return <section className="game-center game-loading"><div className="game-loader"><i/><i/><i/></div><b>正在进入 POIO 游戏中心</b></section>;
  if(!overview)return <section className="game-center game-loading"><b>游戏中心暂时不可用</b><button onClick={onClose}>返回</button></section>;

  return <section className="game-center">
    <header className="game-topbar">
      <button className="game-back" onClick={active==='lobby'?onClose:()=>setActive('lobby')}><ArrowLeft size={18}/><span>{active==='lobby'?'返回 POIO':'游戏大厅'}</span></button>
      <div className="game-brand"><span>POIO</span><b>PLAYGROUND</b><small>{spaceName} · 仅娱乐积分</small></div>
      <div className="game-top-actions">
        <button className="game-sound" title="游戏音效" onClick={()=>setSoundEnabled(value=>!value)}><Volume2 size={17}/><i className={soundEnabled?'on':''}/></button>
        <button className="wallet-pill"><Coins size={17}/><span>{formatPoints(wallet!.balance)}</span><small>积分</small></button>
        <button className="history-button" onClick={()=>setHistoryOpen(value=>!value)}><History size={17}/>记录</button>
        <button className="game-close" onClick={onClose}><X size={18}/></button>
      </div>
    </header>

    {active==='lobby'&&<GameLobby wallet={wallet!} onClaim={claimDaily} busy={busy} onOpen={game=>{setActive(game);sound('tap')}}/>}
    {active==='blackjack'&&<BlackjackGame state={overview.blackjack} wager={blackjackBet} setWager={setBlackjackBet} busy={busy} onStart={startBlackjackGame} onAction={blackjackMove}/>} 
    {active==='mines'&&<MinesGame state={overview.mines} wager={minesBet} setWager={setMinesBet} mineCount={mineCount} setMineCount={setMineCount} busy={busy} onStart={startMinesGame} onReveal={revealCell} onCashout={cashMines}/>} 
    {active==='crash'&&<CrashGame state={overview.crash!} trace={crashTrace} wager={crashBet} setWager={setCrashBet} busy={busy} onBet={placeCrash} onCashout={cashCrash}/>} 
    {active==='slots'&&<SlotsGame spin={slotSpin} wallet={wallet!} wager={slotBet} setWager={setSlotBet} spinning={spinning} busy={busy} onSpin={spin}/>} 
    {active==='wheel'&&<WheelGame spin={wheelSpin} wager={wheelBet} setWager={setWheelBet} rotation={wheelRotation} spinning={wheelSpinning} busy={busy} onSpin={spinWheelGame}/>}
    {active==='gomoku'&&<GomokuGame state={gomoku} rooms={overview.gomokuRooms??[]} wager={gomokuBet} setWager={setGomokuBet} busy={busy} onCreate={createGomoku} onOpen={openGomoku} onMove={gomokuMove} onResign={gomokuResign} onRematch={gomokuRematch} onLeave={gomokuLeave} onInvite={()=>setGomokuInviteOpen(true)}/>}

    {historyOpen&&<HistoryDrawer ledger={overview.ledger} rounds={overview.history} onClose={()=>setHistoryOpen(false)}/>} 
    {gomokuInviteOpen&&gomoku&&<GomokuInvitePicker members={onlineMembers.filter(member=>!gomoku.players.some(player=>player.id===member.id))} invited={gomokuInvited} now={gomokuInviteClock} busy={gomokuInviteBusy} wager={gomoku.wager} onInvite={member=>void inviteGomoku(member)} onClose={()=>setGomokuInviteOpen(false)}/>}
  </section>;
}

function GameLobby({wallet,onClaim,busy,onOpen}:{wallet:Wallet;onClaim:()=>void;busy:boolean;onOpen:(game:Exclude<GameId,'lobby'>)=>void}){
  const dailyReady=!wallet.lastDaily||Date.now()>=wallet.nextDailyAt;
  return <div className="game-lobby">
    <div className="game-hero" style={{backgroundImage:`linear-gradient(90deg,rgba(8,10,18,.08),rgba(8,10,18,.1)),url(${gameHero})`}}>
      <div className="hero-copy"><span>POIO ORIGINAL GAMES</span><h1>和频道里的朋友<br/>一起玩点刺激的</h1><p>五款完整小游戏，共享语音、不打断聊天。既可以独自挑战，也可以实时联机对弈。</p>
        <button onClick={()=>onOpen('gomoku')}><Swords size={18}/>发起五子棋对局</button></div>
      <div className="daily-card"><Gift size={23}/><span><b>{dailyReady?'每日积分已准备':'今日奖励已领取'}</b><small>{dailyReady?`领取 ${formatPoints(wallet.dailyReward)} 娱乐积分`:`下次 ${formatTime(wallet.nextDailyAt)} 可领取`}</small></span><button disabled={!dailyReady||busy} onClick={onClaim}>{dailyReady?'领取':'已领取'}{!dailyReady&&<Check size={15}/>}</button></div>
    </div>
    <div className="game-section-title"><div><span>GAME LIBRARY</span><h2>选择一款游戏</h2></div><small><ShieldCheck size={15}/>服务端判定 · 可验证随机</small></div>
    <div className="game-library">{games.map(game=>{const Icon=game.icon;return <button key={game.id} className={`game-card ${game.id}`} onClick={()=>onOpen(game.id)} style={{'--accent':game.accent} as CSSProperties}>
      <div className="game-card-art" style={{backgroundImage:`url(${game.art})`}}><div className="game-card-icon"><Icon/></div><i/></div>
      <span>{game.eyebrow}</span><h3>{game.name}</h3><p>{game.description}</p><b>开始游戏 <Play size={14} fill="currentColor"/></b>
    </button>})}</div>
    <div className="fair-banner"><ShieldCheck/><div><b>可验证公平</b><span>每局开始前公布 SHA-256 种子摘要，结束后公开原始种子，可自行复算结果。</span></div><small>娱乐积分不可充值、提现或兑换</small></div>
  </div>;
}


function HistoryDrawer({ledger,rounds,onClose}:{ledger:LedgerEntry[];rounds:GameRound[];onClose:()=>void}){
  return <div className="game-history-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><aside className="game-history"><header><span><History/><b>游戏记录</b></span><button onClick={onClose}><X/></button></header><section><h3>最近对局</h3>{rounds.length?rounds.map(round=><div className="round-row" key={round.id}><i className={round.game}>{round.game.slice(0,1).toUpperCase()}</i><span><b>{round.outcome}</b><small>{formatTime(round.completedAt)} · 下注 {formatPoints(round.wager)}</small></span><strong className={round.payout>round.wager?'positive':''}>{round.payout?`+${formatPoints(round.payout)}`:'0'}</strong></div>):<p className="empty-history">还没有完成过游戏</p>}</section><section><h3>积分流水</h3>{ledger.map(item=><div className="ledger-row" key={item.id}><span>{item.kind==='daily'?'每日奖励':item.kind==='wager'?'游戏下注':'游戏结算'}<small>{item.game??'POIO'} · {formatTime(item.createdAt)}</small></span><b className={item.amount>0?'positive':''}>{item.amount>0?'+':''}{formatPoints(item.amount)}</b></div>)}</section></aside></div>;
}
