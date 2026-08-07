import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bomb, Check, CircleDot, Coins, Crown, Dices, Eye, Gift, History, LogOut, Pickaxe, Play, Rocket, ShieldCheck, Sparkles, Spade, Swords, UserPlus, Volume2, X } from 'lucide-react';
import { request, socket } from './api';
import gameHero from './assets/games/poio-game-center-hero.png';
import blackjackCover from './assets/games/blackjack-cover.png';
import minesCover from './assets/games/mines-cover.png';
import crashCover from './assets/games/crash-cover.png';
import slotsCover from './assets/games/slots-cover.png';
import gomokuCover from './assets/games/gomoku-cover.svg';
import './games.css';

type GameId='lobby'|'blackjack'|'mines'|'crash'|'slots'|'gomoku';
type Wallet={balance:number;lastDaily:number;nextDailyAt:number;dailyReward:number;freeSpins:number;freeWager:number};
type FairProof={serverSeedHash:string;clientSeed:string;nonce:number;serverSeed?:string;crashAt?:number};
type CardData={rank?:string;suit?:'spades'|'hearts'|'diamonds'|'clubs';hidden?:boolean};
type BlackjackState={id:string;status:'playing'|'won'|'lost'|'push';outcome?:string;wager:number;payout:number;player:CardData[];dealer:CardData[];playerScore:number;dealerScore?:number;canDouble:boolean;proof:FairProof};
type MinesState={id:string;status:'playing'|'won'|'lost';outcome?:string;wager:number;payout:number;mineCount:number;revealed:number[];mines?:number[];multiplier:number;nextPayout:number;proof:FairProof};
type SlotSymbol='duck'|'bolt'|'gem'|'crown'|'star'|'wild'|'scatter';
type SlotSpin={id:string;wager:number;freeSpin:boolean;grid:SlotSymbol[][];wins:Array<{line:number;symbol:SlotSymbol;count:number;payout:number}>;scatterCount:number;scatterPayout:number;freeSpinsAwarded:number;payout:number;proof:FairProof};
type CrashBet={userId:string;username:string;wager:number;status:'playing'|'cashed'|'lost';cashoutMultiplier?:number;payout:number};
type CrashState={spaceId:string;roundId:string;phase:'betting'|'running'|'crashed';multiplier:number;bettingEndsAt:number;startedAt?:number;endedAt?:number;bets:CrashBet[];myBet?:CrashBet;proof:FairProof};
type GomokuColor='black'|'white';
type GomokuPlayer={id:string;username:string;avatarUrl?:string;color:GomokuColor};
type GomokuRoom={roomId:string;status:'waiting'|'playing'|'finished';wager:number;pot:number;players:GomokuPlayer[];moveCount:number;roundNumber:number;winnerId?:string;updatedAt:number;isMine:boolean};
type GomokuState={roomId:string;spaceId:string;wager:number;pot:number;status:'waiting'|'playing'|'finished';board:Array<GomokuColor|null>;currentColor:GomokuColor;turnUserId?:string;winnerId?:string;result?:'five'|'draw'|'resign';winningLine:number[];lastMove?:number;rematchVotes:string[];roundNumber:number;players:GomokuPlayer[];me:GomokuColor|'spectator';canMove:boolean;createdAt:number;updatedAt:number};
type GameInviteMember={id:string;username:string;avatarUrl?:string};
type LedgerEntry={id:string;amount:number;balanceAfter:number;kind:string;game?:string;roundId?:string;createdAt:number};
type GameRound={id:string;game:string;wager:number;payout:number;outcome:string;createdAt:number;completedAt:number};
type Overview={wallet:Wallet;ledger:LedgerEntry[];history:GameRound[];blackjack?:BlackjackState;mines?:MinesState;slots:{freeSpins:number;freeWager:number};crash?:CrashState;gomokuRooms:GomokuRoom[]};

const games:Array<{id:Exclude<GameId,'lobby'>;name:string;eyebrow:string;description:string;accent:string;art:string;icon:typeof Spade}>=[
  {id:'blackjack',name:'21 点',eyebrow:'BLACKJACK',description:'要牌、停牌、加倍，与庄家正面对决。',accent:'#9d7cff',art:blackjackCover,icon:Spade},
  {id:'mines',name:'Mines',eyebrow:'MINES',description:'翻开安全水晶，随时收下不断上涨的倍率。',accent:'#42dfce',art:minesCover,icon:Bomb},
  {id:'crash',name:'Crash',eyebrow:'CRASH',description:'火箭升空后及时结算，与社区成员共享同一轮。',accent:'#d5ff58',art:crashCover,icon:Rocket},
  {id:'slots',name:'霓虹转轴',eyebrow:'SLOTS',description:'10 条中奖线、Wild、Scatter 与免费旋转。',accent:'#ff75bc',art:slotsCover,icon:Crown},
  {id:'gomoku',name:'联机五子棋',eyebrow:'GOMOKU DUEL',description:'创建棋桌，和社区成员实时对弈，支持观战与再战。',accent:'#c9a66b',art:gomokuCover,icon:CircleDot},
];

const symbolMeta:Record<SlotSymbol,{label:string;className:string}>={
  duck:{label:'◆',className:'duck'},bolt:{label:'ϟ',className:'bolt'},gem:{label:'◇',className:'gem'},
  crown:{label:'♛',className:'crown'},star:{label:'★',className:'star'},wild:{label:'W',className:'wild'},scatter:{label:'S',className:'scatter'},
};

function formatPoints(value:number){return Math.floor(value).toLocaleString('zh-CN');}
function formatTime(value:number){return new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}

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
  const [blackjackBet,setBlackjackBet]=useState(100);const [minesBet,setMinesBet]=useState(100);const [mineCount,setMineCount]=useState(5);const [slotBet,setSlotBet]=useState(100);const [crashBet,setCrashBet]=useState(100);const [gomokuBet,setGomokuBet]=useState(100);
  const [busy,setBusy]=useState(false);const [slotSpin,setSlotSpin]=useState<SlotSpin>();const [spinning,setSpinning]=useState(false);const [crashTrace,setCrashTrace]=useState<number[]>([1]);
  const [gomoku,setGomoku]=useState<GomokuState>();
  const [gomokuInviteOpen,setGomokuInviteOpen]=useState(false);const [gomokuInviteBusy,setGomokuInviteBusy]=useState('');const [gomokuInvited,setGomokuInvited]=useState<string[]>([]);
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
    request<Overview>('game:enter',{spaceId}).then(value=>{if(!disposed){setOverview(value);setLoading(false)}}).catch(error=>{if(!disposed){setLoading(false);onError(error)}});
    const walletUpdate=(next:Wallet)=>setOverview(current=>current?{...current,wallet:next,slots:{freeSpins:next.freeSpins,freeWager:next.freeWager}}:current);
    const crashUpdate=(next:CrashState)=>setOverview(current=>current?{...current,crash:next}:current);
    const gomokuRoomsUpdate=(rooms:GomokuRoom[])=>setOverview(current=>current?{...current,gomokuRooms:rooms}:current);
    const gomokuStateUpdate=(state:GomokuState)=>setGomoku(current=>!current||current.roomId===state.roomId?state:current);
    socket.on('game:wallet',walletUpdate);socket.on('game:crash',crashUpdate);socket.on('game:gomoku:rooms',gomokuRoomsUpdate);socket.on('game:gomoku:state',gomokuStateUpdate);
    return()=>{disposed=true;socket.off('game:wallet',walletUpdate);socket.off('game:crash',crashUpdate);socket.off('game:gomoku:rooms',gomokuRoomsUpdate);socket.off('game:gomoku:state',gomokuStateUpdate);void request('game:leave').catch(()=>{})};
  },[spaceId]);

  useEffect(()=>{
    if(!joinRoomId)return;
    let disposed=false;setActive('gomoku');setBusy(true);
    request<GomokuState>('game:gomoku:join',{spaceId,roomId:joinRoomId}).then(state=>{if(!disposed){setGomoku(state);soundEnabled&&playGameSound('tap')}}).catch(error=>{if(!disposed)onError(error)}).finally(()=>{if(!disposed){setBusy(false);onJoinRoomHandled()}});
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
  const startBlackjackGame=()=>void act(()=>request<{state:BlackjackState;wallet:Wallet}>('game:blackjack:start',{wager:blackjackBet}),value=>{applyResponse(value,'blackjack');sound('tap')});
  const blackjackMove=(action:'hit'|'stand'|'double')=>void act(()=>request<{state:BlackjackState;wallet:Wallet}>('game:blackjack:action',{action}),value=>{applyResponse(value,'blackjack');sound(value.state.status==='won'?'win':value.state.status==='lost'?'lose':'tap')});
  const startMinesGame=()=>void act(()=>request<{state:MinesState;wallet:Wallet}>('game:mines:start',{wager:minesBet,mineCount}),value=>{applyResponse(value,'mines');sound('tap')});
  const revealCell=(cell:number)=>void act(()=>request<{state:MinesState;wallet:Wallet}>('game:mines:reveal',{cell}),value=>{applyResponse(value,'mines');sound(value.state.status==='lost'?'lose':value.state.status==='won'?'win':'tap')});
  const cashMines=()=>void act(()=>request<{state:MinesState;wallet:Wallet}>('game:mines:cashout'),value=>{applyResponse(value,'mines');sound('cash')});
  const spin=async(useFreeSpin=false)=>{
    if(busy||spinning)return;setBusy(true);setSpinning(true);sound('spin');
    try{
      const value=await request<{spin:SlotSpin;wallet:Wallet}>('game:slots:spin',{wager:slotBet,useFreeSpin});
      await new Promise(resolve=>window.setTimeout(resolve,950));applyResponse(value,'slots');sound(value.spin.payout>0?'win':'tap');
    }catch(error){onError(error)}finally{setBusy(false);setSpinning(false)}
  };
  const placeCrash=()=>void act(()=>request<{state:CrashState;wallet:Wallet}>('game:crash:bet',{spaceId,wager:crashBet}),value=>{setOverview(current=>current?{...current,wallet:value.wallet,crash:value.state}:current);sound('tap')});
  const cashCrash=()=>void act(()=>request<{state:CrashState;wallet:Wallet}>('game:crash:cashout',{spaceId}),value=>{setOverview(current=>current?{...current,wallet:value.wallet,crash:value.state}:current);sound('cash')});
  const applyGomoku=(state:GomokuState)=>{setGomoku(state);sound(state.status==='finished'?(state.winnerId&&state.players.find(player=>player.color===state.me)?.id===state.winnerId?'win':'lose'):'tap')};
  const createGomoku=()=>void act(()=>request<GomokuState>('game:gomoku:create',{spaceId,wager:gomokuBet}),applyGomoku);
  const openGomoku=(room:GomokuRoom)=>void act(()=>request<GomokuState>(room.isMine?'game:gomoku:join':room.status==='waiting'?'game:gomoku:join':'game:gomoku:watch',{spaceId,roomId:room.roomId}),applyGomoku);
  const gomokuMove=(cell:number)=>void act(()=>request<GomokuState>('game:gomoku:move',{roomId:gomoku!.roomId,cell}),applyGomoku);
  const gomokuResign=()=>void act(()=>request<GomokuState>('game:gomoku:resign',{roomId:gomoku!.roomId}),applyGomoku);
  const gomokuRematch=()=>void act(()=>request<GomokuState>('game:gomoku:rematch',{roomId:gomoku!.roomId}),applyGomoku);
  const gomokuLeave=()=>void act(()=>request('game:gomoku:leave',{roomId:gomoku!.roomId}),()=>{setGomoku(undefined);sound('tap')});
  const inviteGomoku=async(member:GameInviteMember)=>{
    if(!gomoku||gomokuInviteBusy)return;setGomokuInviteBusy(member.id);
    try{await request('game:gomoku:invite',{spaceId,roomId:gomoku.roomId,targetUserId:member.id});setGomokuInvited(current=>current.includes(member.id)?current:[...current,member.id]);}
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
    {active==='gomoku'&&<GomokuGame state={gomoku} rooms={overview.gomokuRooms??[]} wager={gomokuBet} setWager={setGomokuBet} busy={busy} onCreate={createGomoku} onOpen={openGomoku} onMove={gomokuMove} onResign={gomokuResign} onRematch={gomokuRematch} onLeave={gomokuLeave} onInvite={()=>setGomokuInviteOpen(true)}/>}

    {historyOpen&&<HistoryDrawer ledger={overview.ledger} rounds={overview.history} onClose={()=>setHistoryOpen(false)}/>} 
    {gomokuInviteOpen&&gomoku&&<GomokuInvitePicker members={onlineMembers.filter(member=>!gomoku.players.some(player=>player.id===member.id))} invited={gomokuInvited} busy={gomokuInviteBusy} wager={gomoku.wager} onInvite={member=>void inviteGomoku(member)} onClose={()=>setGomokuInviteOpen(false)}/>}
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
    <div className="game-library">{games.map(game=>{const Icon=game.icon;return <button key={game.id} className={`game-card ${game.id}`} onClick={()=>onOpen(game.id)} style={{'--accent':game.accent} as React.CSSProperties}>
      <div className="game-card-art" style={{backgroundImage:`url(${game.art})`}}><div className="game-card-icon"><Icon/></div><i/></div>
      <span>{game.eyebrow}</span><h3>{game.name}</h3><p>{game.description}</p><b>开始游戏 <Play size={14} fill="currentColor"/></b>
    </button>})}</div>
    <div className="fair-banner"><ShieldCheck/><div><b>可验证公平</b><span>每局开始前公布 SHA-256 种子摘要，结束后公开原始种子，可自行复算结果。</span></div><small>娱乐积分不可充值、提现或兑换</small></div>
  </div>;
}

function BetControls({value,setValue,disabled,multiple=10}:{value:number;setValue:(value:number)=>void;disabled:boolean;multiple?:number}){
  return <div className="bet-controls"><span>下注积分</span><div><button disabled={disabled} onClick={()=>setValue(Math.max(multiple,Math.floor(value/2/multiple)*multiple))}>½</button><input disabled={disabled} type="number" min={10} max={1_000_000} step={multiple} value={value} onChange={event=>setValue(Math.max(10,Math.min(1_000_000,Number(event.target.value)||10)))}/><button disabled={disabled} onClick={()=>setValue(Math.min(1_000_000,value*2))}>2×</button></div></div>;
}

function FairBadge({proof}:{proof?:FairProof}){
  if(!proof)return <div className="fair-proof"><ShieldCheck size={14}/>等待新一局公平种子</div>;
  return <div className="fair-proof" title={proof.serverSeedHash}><ShieldCheck size={14}/><span>种子摘要 {proof.serverSeedHash.slice(0,12)}…</span>{proof.serverSeed&&<b>已公开</b>}</div>;
}

function BlackjackGame({state,wager,setWager,busy,onStart,onAction}:{state?:BlackjackState;wager:number;setWager:(v:number)=>void;busy:boolean;onStart:()=>void;onAction:(action:'hit'|'stand'|'double')=>void}){
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
  if(card.hidden)return <div className="playing-card back" style={{'--card-tilt':tilt} as React.CSSProperties}><i/></div>;
  const symbol=card.suit==='spades'?'♠':card.suit==='hearts'?'♥':card.suit==='diamonds'?'♦':'♣';const red=card.suit==='hearts'||card.suit==='diamonds';
  return <div className={`playing-card ${red?'red':'black'}`} style={{'--card-tilt':tilt} as React.CSSProperties}><span><b>{card.rank}</b>{symbol}</span><i>{symbol}</i></div>;
}

function MinesGame({state,wager,setWager,mineCount,setMineCount,busy,onStart,onReveal,onCashout}:{state?:MinesState;wager:number;setWager:(v:number)=>void;mineCount:number;setMineCount:(v:number)=>void;busy:boolean;onStart:()=>void;onReveal:(cell:number)=>void;onCashout:()=>void}){
  const playing=state?.status==='playing';const revealed=new Set(state?.revealed??[]);const mines=new Set(state?.mines??[]);
  return <GameStage title="Mines" eyebrow="CRYSTAL FIELD" description="每翻开一个安全水晶，倍率都会上涨。踩雷前随时结算。" icon={<Pickaxe/>} accent="#42dfce" art={minesCover}>
    <div className="mines-board-wrap"><div className="mines-grid">{Array.from({length:25},(_,cell)=>{const open=revealed.has(cell);const mine=mines.has(cell);return <button key={cell} disabled={!playing||busy||open} className={`mine-cell ${open&&!mine?'safe':''} ${mine?'mine':''}`} onClick={()=>onReveal(cell)}>{mine?<Bomb/>:open?<i className="crystal-gem"/>:<small>{cell+1}</small>}</button>})}</div>{state&&state.status!=='playing'&&<div className={`game-result ${state.status}`}><Sparkles/><b>{state.outcome}</b><span>{state.payout?`+${formatPoints(state.payout)} 积分`:'本局未获得积分'}</span></div>}</div>
    <div className="game-control-panel"><FairBadge proof={state?.proof}/><BetControls value={wager} setValue={setWager} disabled={!!playing}/><div className="mine-settings"><span>地雷数量</span><div className="mine-counts">{[3,5,8,12].map(value=><button key={value} disabled={!!playing} className={mineCount===value?'active':''} onClick={()=>setMineCount(value)}>{value}</button>)}</div></div><div className="mine-stats"><div><small>当前倍率</small><b>{(state?.multiplier??1).toFixed(2)}×</b></div><div><small>安全格</small><b>{state?.revealed.length??0}/{25-(state?.mineCount??mineCount)}</b></div></div>{!playing?<button className="primary-game-action" disabled={busy} onClick={onStart}><Bomb/>开始</button>:<button className="primary-game-action cash" disabled={busy||state.revealed.length===0} onClick={onCashout}><Coins/>结算 {formatPoints(state.nextPayout)}</button>}</div>
  </GameStage>;
}

function CrashGame({state,trace,wager,setWager,busy,onBet,onCashout}:{state:CrashState;trace:number[];wager:number;setWager:(v:number)=>void;busy:boolean;onBet:()=>void;onCashout:()=>void}){
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

function GomokuGame({state,rooms,wager,setWager,busy,onCreate,onOpen,onMove,onResign,onRematch,onLeave,onInvite}:{state?:GomokuState;rooms:GomokuRoom[];wager:number;setWager:(value:number)=>void;busy:boolean;onCreate:()=>void;onOpen:(room:GomokuRoom)=>void;onMove:(cell:number)=>void;onResign:()=>void;onRematch:()=>void;onLeave:()=>void;onInvite:()=>void}){
  if(!state)return <GameStage title="联机五子棋" eyebrow="GOMOKU DUEL" description="创建棋桌或加入社区成员的房间；落子与胜负均由服务端实时判定。" icon={<CircleDot/>} accent="#c9a66b" art={gomokuCover}>
    <div className="gomoku-room-browser">
      <div className="gomoku-browser-head"><span><Swords/><b>社区棋桌</b><small>{rooms.filter(room=>room.status!=='finished').length} 桌可加入</small></span><i>LIVE</i></div>
      <div className="gomoku-room-list">{rooms.length===0?<div className="gomoku-empty"><CircleDot/><b>还没有人摆下棋盘</b><span>创建第一张棋桌，频道里的朋友会立刻看到。</span></div>:rooms.map(room=><button key={room.roomId} onClick={()=>onOpen(room)} disabled={busy}>
        <div className="gomoku-room-stones"><i className="black"/><i className="white"/></div>
        <span><b>{room.players.map(player=>player.username).join('  vs  ')||'等待玩家'}</b><small>每人 {formatPoints(room.wager)} 积分 · 第 {room.roundNumber} 局 · {room.status==='waiting'?'等待对手':room.status==='playing'?`${room.moveCount} 手`:'已结束'}</small></span>
        {room.isMine&&<em>我的棋桌</em>}<strong>{room.isMine?'返回':room.status==='waiting'?'加入':'观战'}<Play size={12}/></strong>
      </button>)}</div>
    </div>
    <div className="game-control-panel gomoku-lobby-controls"><div className="gomoku-rule-mark"><CircleDot/><span><b>标准 15 路棋盘</b><small>黑棋先行，横、竖或斜线连续五子获胜。</small></span></div><BetControls value={wager} setValue={setWager} disabled={busy}/><div className="gomoku-pot-preview"><Coins/><span><small>双方奖池</small><b>{formatPoints(wager*2)} 积分</b></span></div><div className="gomoku-feature-list"><span><Check/>双方各押同额积分</span><span><Check/>胜者获得完整奖池</span><span><Check/>和棋自动原额退回</span><span><Check/>再战自动交换先手</span></div><button className="primary-game-action" disabled={busy} onClick={onCreate}><Swords/>押 {formatPoints(wager)} 积分创建</button></div>
  </GameStage>;

  const me=state.players.find(player=>player.color===state.me);const turn=state.players.find(player=>player.color===state.currentColor);const winner=state.players.find(player=>player.id===state.winnerId);
  const winning=new Set(state.winningLine);const myRematch=!!me&&state.rematchVotes.includes(me.id);const opponentVote=state.rematchVotes.some(id=>id!==me?.id);
  const headline=state.status==='waiting'?'等待另一位玩家加入':state.status==='playing'?(state.me==='spectator'?`正在观战 · ${turn?.username??'玩家'}落子`:state.canMove?'轮到你落子':`等待 ${turn?.username??'对手'} 落子`):state.result==='draw'?'本局和棋':`${winner?.username??'玩家'} 获胜`;
  return <GameStage title="联机五子棋" eyebrow={`ROUND ${state.roundNumber}`} description={headline} icon={<CircleDot/>} accent="#c9a66b" art={gomokuCover}>
    <div className="gomoku-board-shell">
      <div className="gomoku-board" role="grid" aria-label="十五路五子棋棋盘">
        {Array.from({length:225},(_,cell)=>{const stone=state.board[cell];return <button key={cell} role="gridcell" aria-label={`${Math.floor(cell/15)+1} 行 ${cell%15+1} 列${stone?`，${stone==='black'?'黑棋':'白棋'}`:''}`} disabled={busy||!state.canMove||!!stone} className={`${stone?'occupied':''} ${winning.has(cell)?'winning':''} ${state.lastMove===cell?'last':''}`} onClick={()=>onMove(cell)}>{stone&&<i className={stone}/>}</button>})}
      </div>
      {state.status==='finished'&&<div className="gomoku-result"><Sparkles/><b>{headline}</b><span>{state.result==='draw'?'棋盘已满，双方积分已退回':`${state.result==='resign'?'对手认输':'五子连珠'} · 赢得 ${formatPoints(state.pot)} 积分`}</span></div>}
    </div>
    <div className="game-control-panel gomoku-controls">
      <div className={`gomoku-turn ${state.status}`}><i className={state.currentColor}/><span><small>{state.status==='playing'?'CURRENT TURN':'MATCH STATUS'}</small><b>{headline}</b></span></div>
      <div className="gomoku-players">{(['black','white'] as const).map(color=>{const player=state.players.find(item=>item.color===color);return <div key={color} className={`${state.currentColor===color&&state.status==='playing'?'active':''} ${state.winnerId===player?.id?'winner':''}`}><i className={color}/><span><b>{player?.username??'等待加入'}</b><small>{color==='black'?'黑棋 · 先手':'白棋 · 后手'}{player?.id===me?.id?' · 你':''}</small></span>{state.rematchVotes.includes(player?.id??'')&&<Check/>}</div>})}</div>
      <div className="gomoku-match-info"><span>房间码 <b>{state.roomId.toUpperCase()}</b></span><span>奖池 <b>{formatPoints(state.pot)}</b></span><span>手数 <b>{state.board.filter(Boolean).length}</b></span></div>
      {state.status==='waiting'&&<div className="gomoku-waiting"><i/><span>房间已广播到当前社区</span></div>}
      {state.status==='waiting'&&me&&<button className="primary-game-action gomoku-invite-button" disabled={busy} onClick={onInvite}><UserPlus/>邀请在线成员</button>}
      {state.status==='finished'&&me&&<button className="primary-game-action" disabled={busy||myRematch} onClick={onRematch}><Swords/>{myRematch?(opponentVote?'正在开始…':'等待对手同意'):'再来一局'}</button>}
      {state.status==='playing'&&me&&<button className="gomoku-danger" disabled={busy} onClick={onResign}>认输</button>}
      <button className="gomoku-leave" disabled={busy} onClick={onLeave}><LogOut/>{state.status==='waiting'&&me?'解散棋桌':'离开棋桌'}</button>
      {state.me==='spectator'&&<div className="gomoku-spectating"><Eye/>观战模式</div>}
    </div>
  </GameStage>;
}

function GomokuInvitePicker({members,invited,busy,wager,onInvite,onClose}:{members:GameInviteMember[];invited:string[];busy:string;wager:number;onInvite:(member:GameInviteMember)=>void;onClose:()=>void}){
  return <div className="gomoku-invite-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="gomoku-invite-picker"><header><div><UserPlus/><span><b>邀请在线成员</b><small>对方加入时将支付 {formatPoints(wager)} 积分</small></span></div><button onClick={onClose}><X/></button></header><div className="gomoku-invite-members">{members.length===0?<div className="gomoku-invite-empty"><UserPlus/><b>暂时没有可邀请的在线成员</b><span>成员上线后会自动出现在这里。</span></div>:members.map(member=><article key={member.id}><div className="gomoku-invite-avatar">{member.avatarUrl?<img src={member.avatarUrl} alt=""/>:member.username.slice(0,1).toUpperCase()}</div><span><b>{member.username}</b><small><i/>在线</small></span><button disabled={!!busy||invited.includes(member.id)} onClick={()=>onInvite(member)}>{busy===member.id?'发送中…':invited.includes(member.id)?<><Check/>已邀请</>:<><UserPlus/>邀请</>}</button></article>)}</div></section></div>;
}

function SlotsGame({spin,wallet,wager,setWager,spinning,busy,onSpin}:{spin?:SlotSpin;wallet:Wallet;wager:number;setWager:(v:number)=>void;spinning:boolean;busy:boolean;onSpin:(free?:boolean)=>void}){
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

function GameStage({title,eyebrow,description,icon,accent,art,children}:{title:string;eyebrow:string;description:string;icon:React.ReactNode;accent:string;art:string;children:React.ReactNode}){
  return <div className="game-stage-page" style={{'--game-accent':accent,'--game-art':`url(${art})`} as React.CSSProperties}><div className="stage-heading"><div className="stage-icon">{icon}</div><span><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></span></div><div className="stage-content">{children}</div></div>;
}

function HistoryDrawer({ledger,rounds,onClose}:{ledger:LedgerEntry[];rounds:GameRound[];onClose:()=>void}){
  return <div className="game-history-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><aside className="game-history"><header><span><History/><b>游戏记录</b></span><button onClick={onClose}><X/></button></header><section><h3>最近对局</h3>{rounds.length?rounds.map(round=><div className="round-row" key={round.id}><i className={round.game}>{round.game.slice(0,1).toUpperCase()}</i><span><b>{round.outcome}</b><small>{formatTime(round.completedAt)} · 下注 {formatPoints(round.wager)}</small></span><strong className={round.payout>round.wager?'positive':''}>{round.payout?`+${formatPoints(round.payout)}`:'0'}</strong></div>):<p className="empty-history">还没有完成过游戏</p>}</section><section><h3>积分流水</h3>{ledger.map(item=><div className="ledger-row" key={item.id}><span>{item.kind==='daily'?'每日奖励':item.kind==='wager'?'游戏下注':'游戏结算'}<small>{item.game??'POIO'} · {formatTime(item.createdAt)}</small></span><b className={item.amount>0?'positive':''}>{item.amount>0?'+':''}{formatPoints(item.amount)}</b></div>)}</section></aside></div>;
}
