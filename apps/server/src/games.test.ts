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
  assert.deepEqual(ids.filter(id=>id!=='core').sort(),['blackjack','crash','gomoku','mines','slots','texas-holdem','wheel']);
  assert.equal(plugins.gamePlugins.find(plugin=>plugin.manifest.id==='gomoku')?.manifest.supportsInvites,true);
  assert.equal(plugins.gamePlugins.find(plugin=>plugin.manifest.id==='texas-holdem')?.manifest.supportsInvites,true);
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

test('texas hand evaluator covers wheel straights, full houses and kickers',()=>{
  const card=(rank:string,suit:'spades'|'hearts'|'diamonds'|'clubs')=>({rank,suit});
  const wheel=games.evaluateTexasHand([card('A','spades'),card('2','hearts'),card('3','clubs'),card('4','diamonds'),card('5','spades'),card('K','hearts'),card('9','clubs')]);
  const trips=games.evaluateTexasHand([card('A','spades'),card('A','hearts'),card('A','clubs'),card('K','diamonds'),card('Q','spades'),card('7','hearts'),card('2','clubs')]);
  const fullHouse=games.evaluateTexasHand([card('K','spades'),card('K','hearts'),card('K','clubs'),card('Q','diamonds'),card('Q','spades'),card('7','hearts'),card('2','clubs')]);
  assert.equal(wheel.name,'顺子');assert.equal(wheel.score[1],5);assert.equal(trips.name,'三条');assert.equal(fullHouse.name,'葫芦');assert.ok(games.compareTexasHands(fullHouse,trips)>0);
});

test('texas rooms keep cards private, enforce turns and settle a complete hand',async()=>{
  const first=(await database.register(`texas_a_${Date.now()}`,'Texas-test-password')).user;
  const second=(await database.register(`texas_b_${Date.now()}`,'Texas-test-password')).user;
  const spectator=(await database.register(`texas_s_${Date.now()}`,'Texas-test-password')).user;
  const spaceId='texas-test-space';
  const waiting=games.createTexasRoom(spaceId,first.id,20,1000,6);
  assert.equal(waiting.status,'waiting');assert.equal(games.gameWallet(first.id).balance,9000);
  const joined=games.joinTexasRoom(waiting.roomId,spaceId,second.id);assert.equal(joined.players.length,2);assert.equal(games.gameWallet(second.id).balance,9000);
  let state=games.startTexasHand(waiting.roomId,first.id);assert.equal(state.status,'playing');assert.equal(state.players.find((player:any)=>player.id===first.id)!.hole.length,2);
  const watched=games.watchTexasRoom(waiting.roomId,spaceId,spectator.id);assert.equal(watched.me,'spectator');assert.equal(watched.players.every((player:any)=>player.hole.length===0&&player.cardsHidden===2),true);
  const wrong=state.currentUserId===first.id?second.id:first.id;assert.throws(()=>games.actTexas(waiting.roomId,wrong,'fold'),/轮到/);
  for(let turn=0;state.status==='playing'&&turn<30;turn++){
    const actor=state.currentUserId!;const actorState=games.texasState(waiting.roomId,actor);
    state=games.actTexas(waiting.roomId,actor,actorState.toCall>0?'call':'check');
  }
  assert.equal(state.status,'finished');assert.equal(state.community.length,5);assert.ok(state.proof?.serverSeed);assert.equal(state.players.reduce((sum:number,player:any)=>sum+player.stack,0),2000);
  games.closeTexasRoom(waiting.roomId,first.id);
  assert.equal(games.gameWallet(first.id).balance+games.gameWallet(second.id).balance,20_000);
  assert.equal(games.texasRooms(spaceId,first.id).some((room:any)=>room.roomId===waiting.roomId),false);
  assert.equal(games.leaveTexasRoom(waiting.roomId,first.id),true);
  assert.equal(games.gameWallet(first.id).balance+games.gameWallet(second.id).balance,20_000);
  assert.throws(()=>games.startTexasHand(waiting.roomId,first.id),/不存在/);
});

test('texas all-ins build main and side pots without creating chips',async()=>{
  const players=[];for(let index=0;index<3;index++)players.push((await database.register(`texas_side_${index}_${Date.now()}`,'Texas-test-password')).user);
  const room=games.createTexasRoom('texas-side-space',players[0].id,10,1000,6);games.joinTexasRoom(room.roomId,'texas-side-space',players[1].id);games.joinTexasRoom(room.roomId,'texas-side-space',players[2].id);
  const row=database.db.prepare('SELECT state_json AS state FROM game_texas_rooms WHERE id=?').get(room.roomId) as {state:string};const internal=JSON.parse(row.state);internal.players[0].stack=100;internal.players[1].stack=300;internal.players[2].stack=1000;database.db.prepare('UPDATE game_texas_rooms SET state_json=? WHERE id=?').run(JSON.stringify(internal),room.roomId);
  let state=games.startTexasHand(room.roomId,players[0].id);for(let turn=0;state.status==='playing'&&turn<5;turn++)state=games.actTexas(room.roomId,state.currentUserId!,'all-in');
  assert.equal(state.status,'finished');assert.equal(state.pot,1400);assert.equal(state.players.reduce((sum:number,player:any)=>sum+player.stack,0),1400);assert.equal(state.winners.reduce((sum:number,winner:any)=>sum+winner.amount,0),1400);
  const limits=new Map([[players[0].id,300],[players[1].id,700],[players[2].id,1400]]);for(const winner of state.winners)assert.ok(winner.amount<=limits.get(winner.userId)!);
});

test('texas room lifecycle validates buy-ins, reconnects idempotently and refunds exactly once',async()=>{
  const owner=(await database.register(`texas_lifecycle_owner_${Date.now()}`,'Texas-test-password')).user;
  const guest=(await database.register(`texas_lifecycle_guest_${Date.now()}`,'Texas-test-password')).user;
  assert.throws(()=>games.createTexasRoom('texas-lifecycle-space',owner.id,15,300,6),/整数倍/);
  assert.throws(()=>games.createTexasRoom('texas-lifecycle-space',owner.id,10,190,6),/20 个小盲/);
  assert.throws(()=>games.createTexasRoom('texas-lifecycle-space',owner.id,1000,1_000_000,6),/积分不足/);
  assert.equal(games.gameWallet(owner.id).balance,10_000);
  const room=games.createTexasRoom('texas-lifecycle-space',owner.id,10,200,6);
  assert.throws(()=>games.createTexasRoom('texas-lifecycle-space',owner.id,10,200,6),/已经在/);
  games.joinTexasRoom(room.roomId,'texas-lifecycle-space',guest.id);
  const reconnected=games.joinTexasRoom(room.roomId,'texas-lifecycle-space',guest.id);
  assert.equal(reconnected.players.length,2);assert.equal(games.gameWallet(guest.id).balance,9_800);
  assert.throws(()=>games.closeTexasRoom(room.roomId,guest.id),/只有房主/);
  games.leaveTexasRoom(room.roomId,guest.id);assert.equal(games.gameWallet(guest.id).balance,10_000);
  const closedEvents:Array<{roomId:string;closed?:boolean}>=[];const listener=(event:{roomId:string;closed?:boolean})=>closedEvents.push(event);games.gameEvents.on('texas:update',listener);
  games.closeTexasRoom(room.roomId,owner.id);games.gameEvents.off('texas:update',listener);
  assert.equal(games.gameWallet(owner.id).balance,10_000);assert.equal(closedEvents.at(-1)?.closed,true);
  assert.equal(games.leaveTexasRoom(room.roomId,owner.id),true);assert.equal(games.gameWallet(owner.id).balance,10_000);
  const recreated=games.createTexasRoom('texas-lifecycle-space',owner.id,10,200,2);assert.notEqual(recreated.roomId,room.roomId);games.closeTexasRoom(recreated.roomId,owner.id);
});

test('texas rejects duplicate actions and persists timeout fallback state',async()=>{
  const first=(await database.register(`texas_timeout_a_${Date.now()}`,'Texas-test-password')).user;
  const second=(await database.register(`texas_timeout_b_${Date.now()}`,'Texas-test-password')).user;
  const spectator=(await database.register(`texas_timeout_s_${Date.now()}`,'Texas-test-password')).user;
  const room=games.createTexasRoom('texas-timeout-space',first.id,10,500,2);games.joinTexasRoom(room.roomId,'texas-timeout-space',second.id);
  let state=games.startTexasHand(room.roomId,first.id);assert.throws(()=>games.actTexas(room.roomId,spectator.id,'fold'),/轮到/);
  const firstActor=state.currentUserId!;const firstView=games.texasState(room.roomId,firstActor);state=games.actTexas(room.roomId,firstActor,firstView.toCall?'call':'check');
  assert.throws(()=>games.actTexas(room.roomId,firstActor,'fold'),/轮到/);
  const timedOutUser=state.currentUserId!,deadline=Date.now()-1;
  const row=database.db.prepare('SELECT state_json AS state FROM game_texas_rooms WHERE id=?').get(room.roomId) as {state:string};const internal=JSON.parse(row.state);internal.actionDeadline=deadline;database.db.prepare('UPDATE game_texas_rooms SET state_json=?,updated_at=? WHERE id=?').run(JSON.stringify(internal),Date.now(),room.roomId);
  games.expireTexasAction(room.roomId,timedOutUser,deadline);state=games.texasState(room.roomId,first.id);
  assert.match(state.lastAction?.action??'',/^timeout-(check|fold)$/);
  const persisted=JSON.parse((database.db.prepare('SELECT state_json AS state FROM game_texas_rooms WHERE id=?').get(room.roomId) as {state:string}).state);assert.match(persisted.lastAction.action,/^timeout-(check|fold)$/);
  for(let turn=0;state.status==='playing'&&turn<30;turn++){const actor=state.currentUserId!;const view=games.texasState(room.roomId,actor);state=games.actTexas(room.roomId,actor,view.toCall?'call':'check');}
  assert.equal(state.status,'finished');games.closeTexasRoom(room.roomId,first.id);assert.equal(games.gameWallet(first.id).balance+games.gameWallet(second.id).balance,20_000);
});

test('texas plugin authorizes before mutation and invalidates closed-room invitations',async()=>{
  const owner=(await database.register(`texas_auth_owner_${Date.now()}`,'Texas-test-password')).user;
  const guest=(await database.register(`texas_auth_guest_${Date.now()}`,'Texas-test-password')).user;
  const room=games.createTexasRoom('texas-auth-space',owner.id,10,500,2);
  const plugin=plugins.gamePlugins.find(item=>item.manifest.id==='texas-holdem')!;const handlers=new Map<string,any>();plugin.register({on:(event,handler)=>handlers.set(event,handler)});
  const connected={emit:()=>{},join:()=>{},leave:()=>{}} as any;
  const context={socket:connected,user:owner,requireSpace:()=>[owner,guest],socketsForUser:()=>[connected],createDirectMessage:()=>({id:'invite-message'})};
  assert.throws(()=>handlers.get('game:texas-holdem:start')({},context));
  assert.throws(()=>handlers.get('game:texas-holdem:start')({roomId:room.roomId},{...context,requireSpace:()=>{throw new Error('不在社区')}}),/不在社区/);
  assert.equal(games.texasState(room.roomId,owner.id).handNumber,0);
  handlers.get('game:texas-holdem:invite')({spaceId:'texas-auth-space',roomId:room.roomId,targetUserId:guest.id},context);
  assert.throws(()=>handlers.get('game:texas-holdem:invite')({spaceId:'texas-auth-space',roomId:room.roomId,targetUserId:guest.id},context),/稍后/);
  games.joinTexasRoom(room.roomId,'texas-auth-space',guest.id);let state=games.startTexasHand(room.roomId,owner.id);const actor=state.currentUserId!;const actorUser=actor===owner.id?owner:guest;
  assert.throws(()=>handlers.get('game:texas-holdem:act')({roomId:room.roomId,action:'fold'},{...context,user:actorUser,requireSpace:()=>{throw new Error('不在社区')}}),/不在社区/);
  assert.equal(games.texasState(room.roomId,owner.id).lastAction,undefined);
  for(let turn=0;state.status==='playing'&&turn<30;turn++){const acting=state.currentUserId!;const view=games.texasState(room.roomId,acting);state=games.actTexas(room.roomId,acting,view.toCall?'call':'check');}
  assert.throws(()=>handlers.get('game:texas-holdem:close')({roomId:room.roomId},{...context,requireSpace:()=>{throw new Error('不在社区')}}),/不在社区/);assert.equal(games.texasState(room.roomId,owner.id).status,'finished');
  games.closeTexasRoom(room.roomId,owner.id);
  assert.throws(()=>handlers.get('game:texas-holdem:invite')({spaceId:'texas-auth-space',roomId:room.roomId,targetUserId:guest.id},context),/关闭/);
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
