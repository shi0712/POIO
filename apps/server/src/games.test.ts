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
const plugins=await import('./game-plugins/registry.js');

test('game plugins register independently with unique manifests',()=>{
  const ids=plugins.gamePlugins.map(plugin=>plugin.manifest.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(ids.filter(id=>id!=='core').sort(),['blackjack','crash','gomoku','mines','slots','wheel']);
  assert.equal(plugins.gamePlugins.find(plugin=>plugin.manifest.id==='gomoku')?.manifest.supportsInvites,true);
});

test('fair engine is deterministic and game math stays in valid ranges',()=>{
  const secret={serverSeed:'0123456789abcdef'.repeat(4),serverSeedHash:'hash',clientSeed:'client',nonce:3};
  const first=new engine.FairRandom(secret);const second=new engine.FairRandom(secret);
  assert.deepEqual(Array.from({length:20},()=>first.uint32()),Array.from({length:20},()=>second.uint32()));
  assert.equal(engine.blackjackScore([{rank:'A',suit:'spades'},{rank:'K',suit:'hearts'}]),21);
  assert.equal(engine.blackjackScore([{rank:'A',suit:'spades'},{rank:'A',suit:'hearts'},{rank:'9',suit:'clubs'}]),21);
  assert.ok(engine.minesMultiplier(5,3)>1);
  assert.ok(engine.crashPoint(secret)>=1);
  assert.ok(engine.crashMultiplier(8_500)>=2.7);

  let instantCrashes=0;
  const crashPoints:number[]=[];
  for(let nonce=0;nonce<10_000;nonce++){
    const point=engine.crashPoint({serverSeed:`distribution-${nonce}`,serverSeedHash:'',clientSeed:'poio-test',nonce});
    crashPoints.push(point);
    if(point===1.01)instantCrashes++;
  }
  assert.ok(instantCrashes>=150&&instantCrashes<=250,`instant crash rate drifted: ${instantCrashes}/10000`);
  assert.ok(crashPoints.filter(point=>point>=2).length>=4_700);
  assert.ok(crashPoints.filter(point=>point>=2).length<=5_100);
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
  const wheel=games.spinWheel(userId,100).spin;
  assert.ok(wheel.segmentIndex>=0&&wheel.segmentIndex<10);
  assert.ok(wheel.multiplier>=0&&wheel.multiplier<=10);
  assert.ok(wheel.payout>=0);
  assert.ok(wheel.proof.serverSeed);
  assert.equal(games.wheelState(userId)?.id,wheel.id);
  assert.equal(games.gameHistory(userId,20).some((round:any)=>round.game==='slots'),true);
  assert.equal(games.gameHistory(userId,20).some((round:any)=>round.game==='wheel'),true);
  assert.ok(games.gameLedger(userId,50).length>=5);
});

test('dissolving a waiting gomoku room removes it and permits a fresh room',async()=>{
  const host=(await database.register(`gomoku_cleanup_${Date.now()}`,'Gomoku-test-password')).user;
  const spaceId='gomoku-cleanup-space';
  const first=games.createGomokuRoom(spaceId,host.id,100);
  assert.equal(games.gomokuRooms(spaceId,host.id).some((room:any)=>room.roomId===first.roomId),true);
  games.leaveGomokuRoom(first.roomId,host.id);
  assert.equal(games.gomokuRooms(spaceId,host.id).some((room:any)=>room.roomId===first.roomId),false);
  assert.equal(games.gomokuActiveRoomId(host.id),undefined);
  const second=games.createGomokuRoom(spaceId,host.id,100);
  assert.notEqual(second.roomId,first.roomId);
  games.leaveGomokuRoom(second.roomId,host.id);
});

test('gomoku rooms synchronize players, reject invalid turns and detect five in a row',async()=>{
  const first=(await database.register(`gomoku_a_${Date.now()}`,'Gomoku-test-password')).user;
  const second=(await database.register(`gomoku_b_${Date.now()}`,'Gomoku-test-password')).user;
  const spaceId='gomoku-test-space';
  const waiting=games.createGomokuRoom(spaceId,first.id,200);
  assert.equal(waiting.status,'waiting');
  assert.equal(waiting.me,'black');
  assert.equal(waiting.wager,200);
  assert.equal(games.gameWallet(first.id).balance,9_800);
  const joined=games.joinGomokuRoom(waiting.roomId,spaceId,second.id);
  assert.equal(joined.status,'playing');
  assert.equal(joined.players.length,2);
  assert.equal(joined.pot,400);
  assert.equal(games.gameWallet(second.id).balance,9_800);
  assert.throws(()=>games.playGomokuMove(waiting.roomId,second.id,15),/轮到/);
  const sequence=[[first.id,0],[second.id,15],[first.id,1],[second.id,16],[first.id,2],[second.id,17],[first.id,3],[second.id,18],[first.id,4]] as const;
  let state=joined;
  for(const [userId,cell] of sequence)state=games.playGomokuMove(waiting.roomId,userId,cell);
  assert.equal(state.status,'finished');
  assert.equal(state.winnerId,first.id);
  assert.deepEqual(state.winningLine,[0,1,2,3,4]);
  assert.equal(games.gameWallet(first.id).balance,10_200);
  assert.equal(games.gameWallet(second.id).balance,9_800);
  assert.throws(()=>games.playGomokuMove(waiting.roomId,second.id,19));
  state=games.rematchGomoku(waiting.roomId,first.id);
  assert.equal(state.rematchVotes.length,1);
  state=games.rematchGomoku(waiting.roomId,second.id);
  assert.equal(state.status,'playing');
  assert.equal(state.roundNumber,2);
  assert.equal(state.players.find((player:any)=>player.id===second.id)?.color,'black');
  assert.equal(games.gameWallet(first.id).balance,10_000);
  assert.equal(games.gameWallet(second.id).balance,9_600);
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
