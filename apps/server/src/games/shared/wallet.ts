import { nanoid } from 'nanoid';
import { db } from '../../database.js';
import type { FairSecret } from '../../game-engine.js';
import { gameEvents } from './events.js';

export const STARTING_BALANCE=10_000;
export const DAILY_REWARD=2_000;
export const DAILY_INTERVAL=24*60*60*1000;
export const MAX_BALANCE=100_000_000;
export const MAX_WAGER=1_000_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS game_wallets (
    user_id TEXT PRIMARY KEY,balance INTEGER NOT NULL DEFAULT ${STARTING_BALANCE},last_daily INTEGER NOT NULL DEFAULT 0,
    slot_free_spins INTEGER NOT NULL DEFAULT 0,slot_free_wager INTEGER NOT NULL DEFAULT 100,updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_ledger (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,amount INTEGER NOT NULL,balance_after INTEGER NOT NULL,kind TEXT NOT NULL,
    game TEXT,round_id TEXT,created_at INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_game_ledger_user_time ON game_ledger(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS game_sessions (
    user_id TEXT NOT NULL,game TEXT NOT NULL,state_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,game),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_rounds (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,game TEXT NOT NULL,wager INTEGER NOT NULL,payout INTEGER NOT NULL,
    outcome TEXT NOT NULL,proof_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_game_rounds_user_time ON game_rounds(user_id,completed_at DESC);
`);

export type WalletRow={balance:number;lastDaily:number;freeSpins:number;freeWager:number};
export type WalletView=WalletRow&{nextDailyAt:number;dailyReward:number};
export type LedgerEntry={id:string;amount:number;balanceAfter:number;kind:string;game?:string;roundId?:string;createdAt:number};

export function ensureWallet(userId:string){db.prepare(`INSERT OR IGNORE INTO game_wallets(user_id,balance,last_daily,slot_free_spins,slot_free_wager,updated_at) VALUES(?,?,?,?,?,?)`).run(userId,STARTING_BALANCE,0,0,100,Date.now());}
export function walletRow(userId:string){ensureWallet(userId);return db.prepare(`SELECT balance,last_daily AS lastDaily,slot_free_spins AS freeSpins,slot_free_wager AS freeWager FROM game_wallets WHERE user_id=?`).get(userId) as WalletRow;}
export function gameWallet(userId:string):WalletView{const row=walletRow(userId);return {...row,nextDailyAt:row.lastDaily?row.lastDaily+DAILY_INTERVAL:0,dailyReward:DAILY_REWARD};}
export function gameLedger(userId:string,limit=30){ensureWallet(userId);return db.prepare(`SELECT id,amount,balance_after AS balanceAfter,kind,game,round_id AS roundId,created_at AS createdAt FROM game_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?`).all(userId,Math.max(1,Math.min(100,limit))) as LedgerEntry[];}
export function emitWallet(userId:string){gameEvents.emit('wallet:update',{userId});}
export function changeBalance(userId:string,amount:number,kind:string,game?:string,roundId?:string){ensureWallet(userId);const current=walletRow(userId).balance;const next=current+amount;if(next<0)throw new Error('娱乐积分不足');if(next>MAX_BALANCE)throw new Error('积分余额已达到上限');const now=Date.now();db.prepare('UPDATE game_wallets SET balance=?,updated_at=? WHERE user_id=?').run(next,now,userId);db.prepare(`INSERT INTO game_ledger(id,user_id,amount,balance_after,kind,game,round_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(nanoid(),userId,amount,next,kind,game??null,roundId??null,now);return next;}
export function checkedWager(value:number,{multiple=1}:{multiple?:number}={}){if(!Number.isSafeInteger(value)||value<10||value>MAX_WAGER)throw new Error(`下注范围为 10–${MAX_WAGER.toLocaleString('en-US')} 积分`);if(value%multiple!==0)throw new Error(`下注额必须是 ${multiple} 的整数倍`);return value;}
export function claimGameDaily(userId:string){const result=db.transaction(()=>{const row=walletRow(userId);const now=Date.now();if(row.lastDaily&&now-row.lastDaily<DAILY_INTERVAL)throw new Error('今日奖励已经领取，请稍后再来');const balance=changeBalance(userId,DAILY_REWARD,'daily');db.prepare('UPDATE game_wallets SET last_daily=?,updated_at=? WHERE user_id=?').run(now,now,userId);return {...gameWallet(userId),balance};})();emitWallet(userId);return result;}
export function saveSession(userId:string,game:string,state:unknown){db.prepare(`INSERT INTO game_sessions(user_id,game,state_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,game) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(userId,game,JSON.stringify(state),Date.now());}
export function loadSession<T>(userId:string,game:string){const row=db.prepare('SELECT state_json AS state FROM game_sessions WHERE user_id=? AND game=?').get(userId,game) as {state:string}|undefined;if(!row)return undefined;try{return JSON.parse(row.state) as T;}catch{return undefined;}}
export function recordRound(userId:string,game:string,id:string,wager:number,payout:number,outcome:string,proof:FairSecret,result:unknown,createdAt:number){db.prepare(`INSERT OR REPLACE INTO game_rounds(id,user_id,game,wager,payout,outcome,proof_json,result_json,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,userId,game,wager,payout,outcome,JSON.stringify(proof),JSON.stringify(result),createdAt,Date.now());}
export function gameHistory(userId:string,limit=20){return db.prepare(`SELECT id,game,wager,payout,outcome,proof_json AS proof,result_json AS result,created_at AS createdAt,completed_at AS completedAt FROM game_rounds WHERE user_id=? ORDER BY completed_at DESC,rowid DESC LIMIT ?`).all(userId,Math.max(1,Math.min(50,limit))).map((row:any)=>({...row,proof:JSON.parse(row.proof),result:JSON.parse(row.result)}));}
