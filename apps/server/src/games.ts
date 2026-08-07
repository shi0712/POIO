import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { db } from './database.js';
import {
  FairRandom, blackjackScore, crashMultiplier, crashPoint, createFairSecret,
  isBlackjack, minesMultiplier, shuffledDeck, spinSlots,
  type Card, type FairSecret,
} from './game-engine.js';

const STARTING_BALANCE=10_000;
const DAILY_REWARD=2_000;
const DAILY_INTERVAL=24*60*60*1000;
const MAX_BALANCE=100_000_000;
const MAX_WAGER=1_000_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS game_wallets (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT ${STARTING_BALANCE},
    last_daily INTEGER NOT NULL DEFAULT 0,
    slot_free_spins INTEGER NOT NULL DEFAULT 0,
    slot_free_wager INTEGER NOT NULL DEFAULT 100,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    kind TEXT NOT NULL,
    game TEXT,
    round_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_game_ledger_user_time ON game_ledger(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS game_sessions (
    user_id TEXT NOT NULL,
    game TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,game),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_rounds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game TEXT NOT NULL,
    wager INTEGER NOT NULL,
    payout INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    proof_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_game_rounds_user_time ON game_rounds(user_id,completed_at DESC);
  CREATE TABLE IF NOT EXISTS game_crash_bets (
    round_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wager INTEGER NOT NULL,
    status TEXT NOT NULL,
    cashout_multiplier REAL,
    payout INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(round_id,user_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export const gameEvents=new EventEmitter();

type WalletRow={balance:number;lastDaily:number;freeSpins:number;freeWager:number};
type WalletView={balance:number;lastDaily:number;nextDailyAt:number;dailyReward:number;freeSpins:number;freeWager:number};
type LedgerEntry={id:string;amount:number;balanceAfter:number;kind:string;game?:string;roundId?:string;createdAt:number};

function ensureWallet(userId:string){
  db.prepare(`INSERT OR IGNORE INTO game_wallets(user_id,balance,last_daily,slot_free_spins,slot_free_wager,updated_at)
    VALUES(?,?,?,?,?,?)`).run(userId,STARTING_BALANCE,0,0,100,Date.now());
}

function walletRow(userId:string){
  ensureWallet(userId);
  return db.prepare(`SELECT balance,last_daily AS lastDaily,slot_free_spins AS freeSpins,
    slot_free_wager AS freeWager FROM game_wallets WHERE user_id=?`).get(userId) as WalletRow;
}

export function gameWallet(userId:string):WalletView {
  const row=walletRow(userId);
  return {...row,nextDailyAt:row.lastDaily?row.lastDaily+DAILY_INTERVAL:0,dailyReward:DAILY_REWARD};
}

export function gameLedger(userId:string,limit=30){
  ensureWallet(userId);
  return db.prepare(`SELECT id,amount,balance_after AS balanceAfter,kind,game,round_id AS roundId,created_at AS createdAt
    FROM game_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?`).all(userId,Math.max(1,Math.min(100,limit))) as LedgerEntry[];
}

function emitWallet(userId:string){gameEvents.emit('wallet:update',{userId});}

function changeBalance(userId:string,amount:number,kind:string,game?:string,roundId?:string){
  ensureWallet(userId);
  const current=walletRow(userId).balance;
  const next=current+amount;
  if(next<0)throw new Error('娱乐积分不足');
  if(next>MAX_BALANCE)throw new Error('积分余额已达到上限');
  const now=Date.now();
  db.prepare('UPDATE game_wallets SET balance=?,updated_at=? WHERE user_id=?').run(next,now,userId);
  db.prepare(`INSERT INTO game_ledger(id,user_id,amount,balance_after,kind,game,round_id,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(nanoid(),userId,amount,next,kind,game??null,roundId??null,now);
  return next;
}

function checkedWager(value:number,{multiple=1}:{multiple?:number}={}){
  if(!Number.isSafeInteger(value)||value<10||value>MAX_WAGER)throw new Error(`下注范围为 10–${MAX_WAGER.toLocaleString('en-US')} 积分`);
  if(value%multiple!==0)throw new Error(`下注额必须是 ${multiple} 的整数倍`);
  return value;
}

export function claimGameDaily(userId:string){
  const result=db.transaction(()=>{
    const row=walletRow(userId);const now=Date.now();
    if(row.lastDaily&&now-row.lastDaily<DAILY_INTERVAL)throw new Error('今日奖励已经领取，请稍后再来');
    const balance=changeBalance(userId,DAILY_REWARD,'daily');
    db.prepare('UPDATE game_wallets SET last_daily=?,updated_at=? WHERE user_id=?').run(now,now,userId);
    return {...gameWallet(userId),balance};
  })();
  emitWallet(userId);return result;
}

function saveSession(userId:string,game:string,state:unknown){
  db.prepare(`INSERT INTO game_sessions(user_id,game,state_json,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id,game) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
    .run(userId,game,JSON.stringify(state),Date.now());
}

function loadSession<T>(userId:string,game:string){
  const row=db.prepare('SELECT state_json AS state FROM game_sessions WHERE user_id=? AND game=?').get(userId,game) as {state:string}|undefined;
  if(!row)return undefined;
  try{return JSON.parse(row.state) as T;}catch{return undefined;}
}

function recordRound(userId:string,game:string,id:string,wager:number,payout:number,outcome:string,proof:FairSecret,result:unknown,createdAt:number){
  db.prepare(`INSERT OR REPLACE INTO game_rounds(id,user_id,game,wager,payout,outcome,proof_json,result_json,created_at,completed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,userId,game,wager,payout,outcome,JSON.stringify(proof),JSON.stringify(result),createdAt,Date.now());
}

export function gameHistory(userId:string,limit=20){
  return db.prepare(`SELECT id,game,wager,payout,outcome,proof_json AS proof,result_json AS result,
    created_at AS createdAt,completed_at AS completedAt FROM game_rounds WHERE user_id=?
    ORDER BY completed_at DESC,rowid DESC LIMIT ?`).all(userId,Math.max(1,Math.min(50,limit))).map((row:any)=>({
      ...row,proof:JSON.parse(row.proof),result:JSON.parse(row.result),
    }));
}

type BlackjackState={
  id:string;status:'playing'|'won'|'lost'|'push';outcome?:string;wager:number;payout:number;
  deck:Card[];player:Card[];dealer:Card[];proof:FairSecret;createdAt:number;
};

function blackjackView(state:BlackjackState|undefined){
  if(!state)return undefined;
  const finished=state.status!=='playing';
  return {
    id:state.id,status:state.status,outcome:state.outcome,wager:state.wager,payout:state.payout,
    player:state.player,dealer:finished?state.dealer:[state.dealer[0],{hidden:true}],
    playerScore:blackjackScore(state.player),dealerScore:finished?blackjackScore(state.dealer):undefined,
    canDouble:!finished&&state.player.length===2,
    proof:{serverSeedHash:state.proof.serverSeedHash,clientSeed:state.proof.clientSeed,nonce:state.proof.nonce,...(finished?{serverSeed:state.proof.serverSeed}:{})},
  };
}

function settleBlackjack(userId:string,state:BlackjackState,outcome:string,payout:number,status:BlackjackState['status']){
  state.status=status;state.outcome=outcome;state.payout=payout;
  if(payout>0)changeBalance(userId,payout,'payout','blackjack',state.id);
  saveSession(userId,'blackjack',state);
  recordRound(userId,'blackjack',state.id,state.wager,payout,outcome,state.proof,{player:state.player,dealer:state.dealer},state.createdAt);
  return blackjackView(state);
}

function dealerPlay(state:BlackjackState){
  while(blackjackScore(state.dealer)<17)state.dealer.push(state.deck.pop()!);
}

function compareBlackjack(userId:string,state:BlackjackState){
  dealerPlay(state);
  const player=blackjackScore(state.player),dealer=blackjackScore(state.dealer);
  if(dealer>21||player>dealer)return settleBlackjack(userId,state,'玩家获胜',state.wager*2,'won');
  if(player===dealer)return settleBlackjack(userId,state,'平局',state.wager,'push');
  return settleBlackjack(userId,state,'庄家获胜',0,'lost');
}

export function blackjackState(userId:string){return blackjackView(loadSession<BlackjackState>(userId,'blackjack'));}

export function startBlackjack(userId:string,wagerValue:number){
  const wager=checkedWager(wagerValue);const existing=loadSession<BlackjackState>(userId,'blackjack');
  if(existing?.status==='playing')throw new Error('当前 21 点对局尚未结束');
  const result=db.transaction(()=>{
    const id=nanoid();changeBalance(userId,-wager,'wager','blackjack',id);
    const proof=createFairSecret(`${userId}:${id}`);const deck=shuffledDeck(new FairRandom(proof));
    const state:BlackjackState={id,status:'playing',wager,payout:0,deck,player:[deck.pop()!,deck.pop()!],dealer:[deck.pop()!,deck.pop()!],proof,createdAt:Date.now()};
    if(isBlackjack(state.player)){
      const dealerBlackjack=isBlackjack(state.dealer);
      return dealerBlackjack?settleBlackjack(userId,state,'双方 Blackjack',wager,'push'):
        settleBlackjack(userId,state,'Blackjack',Math.floor(wager*2.5),'won');
    }
    saveSession(userId,'blackjack',state);return blackjackView(state);
  })();
  emitWallet(userId);return {state:result,wallet:gameWallet(userId)};
}

export function blackjackAction(userId:string,action:'hit'|'stand'|'double'){
  const result=db.transaction(()=>{
    const state=loadSession<BlackjackState>(userId,'blackjack');
    if(!state||state.status!=='playing')throw new Error('没有进行中的 21 点对局');
    if(action==='double'){
      if(state.player.length!==2)throw new Error('只能在前两张牌时加倍');
      changeBalance(userId,-state.wager,'wager','blackjack',state.id);state.wager*=2;
      state.player.push(state.deck.pop()!);
      if(blackjackScore(state.player)>21)return settleBlackjack(userId,state,'玩家爆牌',0,'lost');
      return compareBlackjack(userId,state);
    }
    if(action==='hit'){
      state.player.push(state.deck.pop()!);const score=blackjackScore(state.player);
      if(score>21)return settleBlackjack(userId,state,'玩家爆牌',0,'lost');
      if(score===21)return compareBlackjack(userId,state);
      saveSession(userId,'blackjack',state);return blackjackView(state);
    }
    return compareBlackjack(userId,state);
  })();
  emitWallet(userId);return {state:result,wallet:gameWallet(userId)};
}

type MinesState={
  id:string;status:'playing'|'won'|'lost';wager:number;payout:number;mineCount:number;mines:number[];
  revealed:number[];proof:FairSecret;createdAt:number;outcome?:string;
};

function minesView(state:MinesState|undefined){
  if(!state)return undefined;
  const finished=state.status!=='playing';const multiplier=minesMultiplier(state.mineCount,state.revealed.length);
  return {id:state.id,status:state.status,outcome:state.outcome,wager:state.wager,payout:state.payout,mineCount:state.mineCount,
    revealed:state.revealed,multiplier,nextPayout:Math.floor(state.wager*multiplier),...(finished?{mines:state.mines}:{}),
    proof:{serverSeedHash:state.proof.serverSeedHash,clientSeed:state.proof.clientSeed,nonce:state.proof.nonce,...(finished?{serverSeed:state.proof.serverSeed}:{})}};
}

export function minesState(userId:string){return minesView(loadSession<MinesState>(userId,'mines'));}

export function startMines(userId:string,wagerValue:number,mineCount:number){
  const wager=checkedWager(wagerValue);if(!Number.isSafeInteger(mineCount)||mineCount<1||mineCount>20)throw new Error('地雷数量必须为 1–20');
  const existing=loadSession<MinesState>(userId,'mines');if(existing?.status==='playing')throw new Error('当前 Mines 对局尚未结束');
  const result=db.transaction(()=>{
    const id=nanoid();changeBalance(userId,-wager,'wager','mines',id);
    const proof=createFairSecret(`${userId}:${id}`);const random=new FairRandom(proof);const cells=Array.from({length:25},(_,index)=>index);
    for(let index=cells.length-1;index>0;index--){const other=random.int(index+1);[cells[index],cells[other]]=[cells[other],cells[index]];}
    const state:MinesState={id,status:'playing',wager,payout:0,mineCount,mines:cells.slice(0,mineCount).sort((a,b)=>a-b),revealed:[],proof,createdAt:Date.now()};
    saveSession(userId,'mines',state);return minesView(state);
  })();emitWallet(userId);return {state:result,wallet:gameWallet(userId)};
}

export function revealMineCell(userId:string,cell:number){
  if(!Number.isSafeInteger(cell)||cell<0||cell>=25)throw new Error('格子编号无效');
  const result=db.transaction(()=>{
    const state=loadSession<MinesState>(userId,'mines');if(!state||state.status!=='playing')throw new Error('没有进行中的 Mines 对局');
    if(state.revealed.includes(cell))return minesView(state);
    if(state.mines.includes(cell)){
      state.status='lost';state.outcome='踩中地雷';saveSession(userId,'mines',state);
      recordRound(userId,'mines',state.id,state.wager,0,state.outcome,state.proof,{mines:state.mines,revealed:state.revealed,hit:cell},state.createdAt);
      return minesView(state);
    }
    state.revealed.push(cell);state.revealed.sort((a,b)=>a-b);
    if(state.revealed.length===25-state.mineCount){
      const payout=Math.floor(state.wager*minesMultiplier(state.mineCount,state.revealed.length));
      state.status='won';state.payout=payout;state.outcome='清空安全格';changeBalance(userId,payout,'payout','mines',state.id);
      recordRound(userId,'mines',state.id,state.wager,payout,state.outcome,state.proof,{mines:state.mines,revealed:state.revealed},state.createdAt);
    }
    saveSession(userId,'mines',state);return minesView(state);
  })();emitWallet(userId);return {state:result,wallet:gameWallet(userId)};
}

export function cashoutMines(userId:string){
  const result=db.transaction(()=>{
    const state=loadSession<MinesState>(userId,'mines');if(!state||state.status!=='playing')throw new Error('没有进行中的 Mines 对局');
    if(state.revealed.length===0)throw new Error('至少翻开一个安全格后才能结算');
    const payout=Math.floor(state.wager*minesMultiplier(state.mineCount,state.revealed.length));
    state.status='won';state.payout=payout;state.outcome='主动结算';changeBalance(userId,payout,'payout','mines',state.id);saveSession(userId,'mines',state);
    recordRound(userId,'mines',state.id,state.wager,payout,state.outcome,state.proof,{mines:state.mines,revealed:state.revealed},state.createdAt);
    return minesView(state);
  })();emitWallet(userId);return {state:result,wallet:gameWallet(userId)};
}

export function slotState(userId:string){const wallet=gameWallet(userId);return {freeSpins:wallet.freeSpins,freeWager:wallet.freeWager};}

export function playSlots(userId:string,wagerValue:number,useFreeSpin=false){
  const result=db.transaction(()=>{
    const row=walletRow(userId);const free=useFreeSpin&&row.freeSpins>0;
    const wager=checkedWager(free?row.freeWager:wagerValue,{multiple:10});const id=nanoid();
    if(free)db.prepare('UPDATE game_wallets SET slot_free_spins=slot_free_spins-1,updated_at=? WHERE user_id=?').run(Date.now(),userId);
    else {changeBalance(userId,-wager,'wager','slots',id);db.prepare('UPDATE game_wallets SET slot_free_wager=?,updated_at=? WHERE user_id=?').run(wager,Date.now(),userId);}
    const proof=createFairSecret(`${userId}:${id}`);const spin=spinSlots(new FairRandom(proof),wager);
    if(spin.payout>0)changeBalance(userId,spin.payout,'payout','slots',id);
    if(spin.freeSpinsAwarded>0)db.prepare('UPDATE game_wallets SET slot_free_spins=slot_free_spins+?,updated_at=? WHERE user_id=?').run(spin.freeSpinsAwarded,Date.now(),userId);
    recordRound(userId,'slots',id,free?0:wager,spin.payout,spin.payout>0?'中奖':'未中奖',proof,spin,Date.now());
    return {id,wager,freeSpin:free,...spin,proof:{...proof,serverSeed:proof.serverSeed}};
  })();emitWallet(userId);return {spin:result,wallet:gameWallet(userId)};
}

type CrashPhase='betting'|'running'|'crashed';
type CrashRoom={
  spaceId:string;roundId:string;phase:CrashPhase;proof:FairSecret;crashAt:number;
  bettingEndsAt:number;startedAt?:number;endedAt?:number;timer?:NodeJS.Timeout;ticker?:NodeJS.Timeout;
};

const crashRooms=new Map<string,CrashRoom>();

function emitCrash(spaceId:string){gameEvents.emit('crash:update',{spaceId});}

function createCrashRound(spaceId:string){
  const roundId=nanoid();const proof=createFairSecret(`poio:${spaceId}:${roundId}`);
  const room:CrashRoom={spaceId,roundId,phase:'betting',proof,crashAt:crashPoint(proof),bettingEndsAt:Date.now()+5_000};
  crashRooms.set(spaceId,room);emitCrash(spaceId);
  room.timer=setTimeout(()=>startCrashRound(room),5_000);room.timer.unref();
  return room;
}

function startCrashRound(room:CrashRoom){
  if(crashRooms.get(room.spaceId)!==room)return;
  room.phase='running';room.startedAt=Date.now();emitCrash(room.spaceId);
  room.ticker=setInterval(()=>{
    if(crashRooms.get(room.spaceId)!==room||room.phase!=='running')return;
    if(crashMultiplier(Date.now()-(room.startedAt??Date.now()))>=room.crashAt){finishCrashRound(room);return;}
    emitCrash(room.spaceId);
  },100);room.ticker.unref();
}

function finishCrashRound(room:CrashRoom){
  if(room.phase!=='running')return;
  room.phase='crashed';room.endedAt=Date.now();if(room.ticker)clearInterval(room.ticker);
  db.prepare(`UPDATE game_crash_bets SET status='lost' WHERE round_id=? AND status='playing'`).run(room.roundId);
  const lost=db.prepare(`SELECT user_id AS userId,wager FROM game_crash_bets WHERE round_id=? AND status='lost'`).all(room.roundId) as Array<{userId:string;wager:number}>;
  for(const bet of lost)recordRound(bet.userId,'crash',`${room.roundId}:${bet.userId}`,bet.wager,0,`爆点 ${room.crashAt.toFixed(2)}x`,room.proof,{spaceId:room.spaceId,crashAt:room.crashAt},room.bettingEndsAt-5_000);
  emitCrash(room.spaceId);
  room.timer=setTimeout(()=>createCrashRound(room.spaceId),3_500);room.timer.unref();
}

function crashRoom(spaceId:string){return crashRooms.get(spaceId)??createCrashRound(spaceId);}

function crashCurrentMultiplier(room:CrashRoom){
  if(room.phase==='betting')return 1;
  if(room.phase==='crashed')return room.crashAt;
  return crashMultiplier(Date.now()-(room.startedAt??Date.now()));
}

export function crashState(spaceId:string,userId:string){
  const room=crashRoom(spaceId);
  const myBet=db.prepare(`SELECT wager,status,cashout_multiplier AS cashoutMultiplier,payout
    FROM game_crash_bets WHERE round_id=? AND user_id=?`).get(room.roundId,userId);
  const bets=db.prepare(`SELECT b.user_id AS userId,u.username,b.wager,b.status,b.cashout_multiplier AS cashoutMultiplier,b.payout
    FROM game_crash_bets b JOIN users u ON u.id=b.user_id WHERE b.round_id=? ORDER BY b.created_at ASC`).all(room.roundId);
  return {spaceId,roundId:room.roundId,phase:room.phase,multiplier:crashCurrentMultiplier(room),bettingEndsAt:room.bettingEndsAt,
    startedAt:room.startedAt,endedAt:room.endedAt,bets,myBet,
    proof:{serverSeedHash:room.proof.serverSeedHash,clientSeed:room.proof.clientSeed,nonce:room.proof.nonce,
      ...(room.phase==='crashed'?{serverSeed:room.proof.serverSeed,crashAt:room.crashAt}:{})}};
}

export function placeCrashBet(spaceId:string,userId:string,wagerValue:number){
  const wager=checkedWager(wagerValue);const room=crashRoom(spaceId);if(room.phase!=='betting'||Date.now()>=room.bettingEndsAt)throw new Error('本轮下注已经结束');
  db.transaction(()=>{
    const exists=db.prepare('SELECT 1 FROM game_crash_bets WHERE round_id=? AND user_id=?').get(room.roundId,userId);
    if(exists)throw new Error('本轮已经下注');
    changeBalance(userId,-wager,'wager','crash',room.roundId);
    db.prepare(`INSERT INTO game_crash_bets(round_id,space_id,user_id,wager,status,created_at) VALUES(?,?,?,?,?,?)`)
      .run(room.roundId,spaceId,userId,wager,'playing',Date.now());
  })();emitWallet(userId);emitCrash(spaceId);return {state:crashState(spaceId,userId),wallet:gameWallet(userId)};
}

export function cashoutCrash(spaceId:string,userId:string){
  const room=crashRoom(spaceId);if(room.phase!=='running')throw new Error('当前不在可结算阶段');
  const multiplier=crashCurrentMultiplier(room);if(multiplier>=room.crashAt)throw new Error('本轮已经爆点');
  const result=db.transaction(()=>{
    const bet=db.prepare(`SELECT wager,status FROM game_crash_bets WHERE round_id=? AND user_id=?`).get(room.roundId,userId) as {wager:number;status:string}|undefined;
    if(!bet)throw new Error('本轮还没有下注');if(bet.status!=='playing')throw new Error('本轮已经结算');
    const payout=Math.floor(bet.wager*multiplier);changeBalance(userId,payout,'payout','crash',room.roundId);
    db.prepare(`UPDATE game_crash_bets SET status='cashed',cashout_multiplier=?,payout=? WHERE round_id=? AND user_id=?`)
      .run(multiplier,payout,room.roundId,userId);
    recordRound(userId,'crash',`${room.roundId}:${userId}`,bet.wager,payout,`${multiplier.toFixed(2)}x 结算`,room.proof,{spaceId,crashAt:room.crashAt,cashoutMultiplier:multiplier},room.bettingEndsAt-5_000);
    return payout;
  })();emitWallet(userId);emitCrash(spaceId);return {payout:result,state:crashState(spaceId,userId),wallet:gameWallet(userId)};
}

export function gameOverview(userId:string,spaceId?:string){
  return {wallet:gameWallet(userId),ledger:gameLedger(userId,12),history:gameHistory(userId,12),
    blackjack:blackjackState(userId),mines:minesState(userId),slots:slotState(userId),
    crash:spaceId?crashState(spaceId,userId):undefined};
}
