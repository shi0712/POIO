import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath=path.join(os.tmpdir(),`poio-games-test-${process.pid}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.BACKUP_PATH=path.join(os.tmpdir(),`poio-games-backups-${process.pid}`);
process.env.UPLOAD_PATH=path.join(os.tmpdir(),`poio-games-uploads-${process.pid}`);
const database=await import('./database.js');
const games=await import('./games.js');
const engine=await import('./game-engine.js');

test('fair engine is deterministic and game math stays in valid ranges',()=>{
  const secret={serverSeed:'0123456789abcdef'.repeat(4),serverSeedHash:'hash',clientSeed:'client',nonce:3};
  const first=new engine.FairRandom(secret);const second=new engine.FairRandom(secret);
  assert.deepEqual(Array.from({length:20},()=>first.uint32()),Array.from({length:20},()=>second.uint32()));
  assert.equal(engine.blackjackScore([{rank:'A',suit:'spades'},{rank:'K',suit:'hearts'}]),21);
  assert.equal(engine.blackjackScore([{rank:'A',suit:'spades'},{rank:'A',suit:'hearts'},{rank:'9',suit:'clubs'}]),21);
  assert.ok(engine.minesMultiplier(5,3)>1);
  assert.ok(engine.crashPoint(secret)>=1);
  assert.ok(engine.crashMultiplier(8_500)>=2.7);
});

test('wallet ledger and all turn-based games are server authoritative',async()=>{
  const account=await database.register(`games_${Date.now()}`,'Games-test-password');
  const userId=account.user.id;
  assert.equal(games.gameWallet(userId).balance,10_000);
  assert.equal(games.claimGameDaily(userId).balance,12_000);
  assert.throws(()=>games.claimGameDaily(userId));

  let blackjack=games.startBlackjack(userId,100).state;
  for(let count=0;blackjack?.status==='playing'&&count<12;count++)blackjack=games.blackjackAction(userId,'stand').state;
  assert.notEqual(blackjack?.status,'playing');
  assert.ok(Array.isArray(blackjack?.dealer));
  assert.ok(blackjack?.proof.serverSeed);

  const mines=games.startMines(userId,100,5).state;
  assert.ok(mines);
  assert.equal(mines.status,'playing');
  assert.equal('mines' in mines,false);
  const persisted=database.db.prepare("SELECT state_json AS state FROM game_sessions WHERE user_id=? AND game='mines'").get(userId) as {state:string};
  const internal=JSON.parse(persisted.state) as {mines:number[]};
  const safe=Array.from({length:25},(_,index)=>index).find(index=>!internal.mines.includes(index))!;
  const revealed=games.revealMineCell(userId,safe).state;
  assert.ok(revealed);
  assert.deepEqual(revealed.revealed,[safe]);
  const cashed=games.cashoutMines(userId).state;
  assert.ok(cashed);
  assert.equal(cashed.status,'won');
  assert.ok(cashed.payout>=100);
  assert.deepEqual(cashed.mines,internal.mines);

  const slots=games.playSlots(userId,100).spin;
  assert.equal(slots.grid.length,5);
  assert.equal(slots.grid.every(reel=>reel.length===3),true);
  assert.ok(slots.payout>=0);
  assert.equal(games.gameHistory(userId,20).some((round:any)=>round.game==='slots'),true);
  assert.ok(games.gameLedger(userId,50).length>=5);
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
