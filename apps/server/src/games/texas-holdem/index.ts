import { nanoid } from 'nanoid';
import { db } from '../../database.js';
import { createFairSecret, FairRandom, shuffledDeck, type Card } from '../../game-engine.js';
import { changeBalance, checkedWager, emitWallet, recordRound } from '../shared/wallet.js';
import { gameEvents } from '../shared/events.js';
import { compareTexasHands, evaluateTexasHand } from './evaluator.js';
import type { TexasInternalState, TexasPlayerInternal, TexasRoomRow, TexasRoomStatus } from './types.js';

const GAME_ID='texas-holdem';
const ACTION_TIMEOUT_MS=30_000;
const MIN_PLAYERS=2;
const MAX_PLAYERS=6;
const timers=new Map<string,NodeJS.Timeout>();

db.exec(`
  CREATE TABLE IF NOT EXISTS game_texas_rooms (
    id TEXT PRIMARY KEY,space_id TEXT NOT NULL,host_user_id TEXT NOT NULL,small_blind INTEGER NOT NULL,
    buy_in INTEGER NOT NULL,max_players INTEGER NOT NULL,status TEXT NOT NULL,state_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
    FOREIGN KEY(host_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_game_texas_space_time ON game_texas_rooms(space_id,updated_at DESC);
`);

function roomRow(roomId:string){return db.prepare(`SELECT id,space_id AS spaceId,host_user_id AS hostUserId,small_blind AS smallBlind,buy_in AS buyIn,max_players AS maxPlayers,status,state_json AS stateJson,created_at AS createdAt,updated_at AS updatedAt FROM game_texas_rooms WHERE id=?`).get(roomId) as TexasRoomRow|undefined;}
function parseState(row:TexasRoomRow){const state=JSON.parse(row.stateJson) as TexasInternalState;state.status=row.status;return state;}
function user(userId:string){const value=db.prepare('SELECT id,username,avatar_url AS avatarUrl FROM users WHERE id=?').get(userId) as {id:string;username:string;avatarUrl?:string}|undefined;if(!value)throw new Error('玩家不存在');return value;}
function emit(state:TexasInternalState,closed=false){gameEvents.emit('texas:update',{spaceId:state.spaceId,roomId:state.roomId,closed});}
function activeRoom(userId:string){return db.prepare(`SELECT id FROM game_texas_rooms WHERE status!='closed' AND EXISTS(SELECT 1 FROM json_each(game_texas_rooms.state_json,'$.players') WHERE json_extract(value,'$.id')=?) LIMIT 1`).get(userId) as {id:string}|undefined;}
export function texasActiveRoomId(userId:string){return activeRoom(userId)?.id;}

function save(state:TexasInternalState){
  state.updatedAt=Date.now();
  db.prepare('UPDATE game_texas_rooms SET host_user_id=?,status=?,state_json=?,updated_at=? WHERE id=?').run(state.hostUserId,state.status,JSON.stringify(state),state.updatedAt,state.roomId);
  return state;
}

function seatOrder(players:TexasPlayerInternal[]){return [...players].sort((left,right)=>left.seat-right.seat);}
function nextPlayer(players:TexasPlayerInternal[],fromSeat:number,predicate:(player:TexasPlayerInternal)=>boolean){
  const ordered=seatOrder(players);if(!ordered.length)return undefined;
  for(let offset=1;offset<=ordered.length;offset++){
    const candidate=ordered.find(player=>player.seat>fromSeat)??ordered[0];
    if(predicate(candidate))return candidate;
    fromSeat=candidate.seat;
  }
  return undefined;
}
function nextSeat(players:TexasPlayerInternal[],fromSeat:number){return nextPlayer(players,fromSeat,player=>player.stack>0)?.seat;}
function livePlayers(state:TexasInternalState){return state.players.filter(player=>player.status!=='folded'&&player.status!=='out');}
function actingPlayers(state:TexasInternalState){return livePlayers(state).filter(player=>player.stack>0&&player.status==='active');}
function pot(state:TexasInternalState){return state.players.reduce((sum,player)=>sum+player.totalBet,0);}
function commit(player:TexasPlayerInternal,amount:number){const paid=Math.max(0,Math.min(player.stack,amount));player.stack-=paid;player.streetBet+=paid;player.totalBet+=paid;if(player.stack===0&&player.status==='active')player.status='all-in';return paid;}

function schedule(state:TexasInternalState){
  const previous=timers.get(state.roomId);if(previous)clearTimeout(previous);timers.delete(state.roomId);
  if(state.status!=='playing'||!state.currentUserId||!state.actionDeadline)return;
  const expectedUserId=state.currentUserId,expectedDeadline=state.actionDeadline;
  const timer=setTimeout(()=>{timers.delete(state.roomId);try{expireTexasAction(state.roomId,expectedUserId,expectedDeadline);}catch{}},Math.max(1,expectedDeadline-Date.now()));
  timer.unref();timers.set(state.roomId,timer);
}

function setTurn(state:TexasInternalState,fromSeat:number){
  const next=nextPlayer(state.players,fromSeat,player=>state.pendingUserIds.includes(player.id)&&player.status==='active'&&player.stack>0);
  state.currentUserId=next?.id;state.actionDeadline=next?Date.now()+ACTION_TIMEOUT_MS:undefined;
}

function revealStreet(state:TexasInternalState,count:number){state.deck.pop();for(let index=0;index<count;index++){const card=state.deck.pop();if(card)state.community.push(card);}}

function distribute(state:TexasInternalState,uncontestedWinnerId?:string){
  const awards=new Map<string,{amount:number;handName:string;cards:Card[]}>();
  if(uncontestedWinnerId){awards.set(uncontestedWinnerId,{amount:pot(state),handName:'其他玩家弃牌',cards:[]});}
  else{
    const levels=[...new Set(state.players.map(player=>player.totalBet).filter(Boolean))].sort((a,b)=>a-b);let previous=0;
    for(const level of levels){
      const contributors=state.players.filter(player=>player.totalBet>=level);const amount=(level-previous)*contributors.length;previous=level;
      const eligible=contributors.filter(player=>player.status!=='folded'&&player.status!=='out');if(!eligible.length)continue;
      const hands=eligible.map(player=>({player,hand:evaluateTexasHand([...player.hole,...state.community])}));
      const best=hands.reduce((value,item)=>compareTexasHands(item.hand,value.hand)>0?item:value,hands[0]).hand;
      const winners=hands.filter(item=>compareTexasHands(item.hand,best)===0).sort((left,right)=>{
        const leftRaw=(left.player.seat-(state.buttonSeat??0)+state.maxPlayers)%state.maxPlayers;const leftDistance=leftRaw||state.maxPlayers;
        const rightRaw=(right.player.seat-(state.buttonSeat??0)+state.maxPlayers)%state.maxPlayers;const rightDistance=rightRaw||state.maxPlayers;
        return leftDistance-rightDistance;
      });
      const share=Math.floor(amount/winners.length),remainder=amount%winners.length;
      winners.forEach((winner,index)=>{const current=awards.get(winner.player.id)??{amount:0,handName:winner.hand.name,cards:winner.hand.cards};current.amount+=share+(index<remainder?1:0);awards.set(winner.player.id,current);});
    }
  }
  for(const [userId,award] of awards){const player=state.players.find(item=>item.id===userId);if(player)player.stack+=award.amount;}
  state.winners=[...awards].map(([userId,award])=>({userId,...award}));
}

function finishHand(state:TexasInternalState,uncontestedWinnerId?:string){
  if(!uncontestedWinnerId)while(state.community.length<5)revealStreet(state,state.community.length===0?3:1);
  distribute(state,uncontestedWinnerId);
  state.status='finished';state.street=uncontestedWinnerId?'finished':'showdown';state.currentUserId=undefined;state.pendingUserIds=[];state.actionDeadline=undefined;
  const proof=state.proof!;
  for(const player of state.players){const won=state.winners.find(winner=>winner.userId===player.id)?.amount??0;recordRound(player.id,GAME_ID,`${state.handId}:${player.id}`,player.totalBet,won,won>player.totalBet?'win':won===player.totalBet?'push':'loss',proof,{roomId:state.roomId,handNumber:state.handNumber,community:state.community,hole:player.hole,winners:state.winners},state.createdAt);}
  return state;
}

function advanceStreet(state:TexasInternalState){
  const remaining=livePlayers(state);if(remaining.length===1)return finishHand(state,remaining[0].id);
  if(state.street==='river')return finishHand(state);
  if(state.street==='preflop'){revealStreet(state,3);state.street='flop';}
  else if(state.street==='flop'){revealStreet(state,1);state.street='turn';}
  else if(state.street==='turn'){revealStreet(state,1);state.street='river';}
  for(const player of state.players)player.streetBet=0;
  state.currentBet=0;state.minRaise=state.bigBlind;state.pendingUserIds=actingPlayers(state).map(player=>player.id);
  if(state.pendingUserIds.length<=1)return advanceStreet(state);
  setTurn(state,state.buttonSeat??-1);return state;
}

function afterAction(state:TexasInternalState,actorSeat:number){
  const remaining=livePlayers(state);if(remaining.length===1)return finishHand(state,remaining[0].id);
  state.pendingUserIds=state.pendingUserIds.filter(userId=>state.players.some(player=>player.id===userId&&player.status==='active'&&player.stack>0));
  if(!state.pendingUserIds.length)return advanceStreet(state);
  setTurn(state,actorSeat);return state;
}

function applyAction(state:TexasInternalState,userId:string,action:'fold'|'check'|'call'|'raise'|'all-in',raiseTo?:number){
  if(state.status!=='playing')throw new Error('当前没有进行中的牌局');
  if(state.currentUserId!==userId)throw new Error('还没有轮到你操作');
  const player=state.players.find(item=>item.id===userId);if(!player||player.status!=='active'||player.stack<=0)throw new Error('当前玩家不能操作');
  const toCall=Math.max(0,state.currentBet-player.streetBet);let amount=0;
  if(action==='fold'){player.status='folded';state.pendingUserIds=state.pendingUserIds.filter(id=>id!==userId);}
  else if(action==='check'){if(toCall!==0)throw new Error('当前需要跟注，不能过牌');state.pendingUserIds=state.pendingUserIds.filter(id=>id!==userId);}
  else if(action==='call'){if(toCall===0)throw new Error('当前无需跟注');amount=commit(player,toCall);state.pendingUserIds=state.pendingUserIds.filter(id=>id!==userId);}
  else if(action==='all-in'&&player.streetBet+player.stack<=state.currentBet){amount=commit(player,toCall);state.pendingUserIds=state.pendingUserIds.filter(id=>id!==userId);}
  else{
    const maximum=player.streetBet+player.stack;const target=action==='all-in'?maximum:raiseTo;
    if(!Number.isSafeInteger(target)||target===undefined||target<=player.streetBet||target<=state.currentBet)throw new Error('加注金额无效');
    if(target>maximum)throw new Error('筹码不足');
    const minimum=state.currentBet+state.minRaise;if(target<minimum&&target!==maximum)throw new Error(`最小加注到 ${minimum} 筹码`);
    amount=commit(player,target-player.streetBet);const raiseSize=target-state.currentBet;
    if(raiseSize>=state.minRaise)state.minRaise=raiseSize;
    state.currentBet=target;state.pendingUserIds=actingPlayers(state).filter(item=>item.id!==userId).map(item=>item.id);
  }
  state.lastAction={userId,action,amount:amount||undefined,at:Date.now()};return afterAction(state,player.seat);
}

function project(state:TexasInternalState,userId:string){
  const me=state.players.find(player=>player.id===userId);const showDown=state.status==='finished'&&state.street==='showdown';
  return{
    roomId:state.roomId,spaceId:state.spaceId,hostUserId:state.hostUserId,smallBlind:state.smallBlind,bigBlind:state.bigBlind,buyIn:state.buyIn,maxPlayers:state.maxPlayers,
    status:state.status,street:state.street,handNumber:state.handNumber,handId:state.handId,buttonSeat:state.buttonSeat,smallBlindSeat:state.smallBlindSeat,bigBlindSeat:state.bigBlindSeat,
    currentUserId:state.currentUserId,currentBet:state.currentBet,minRaise:state.minRaise,pot:pot(state),community:state.community,actionDeadline:state.actionDeadline,winners:state.winners,lastAction:state.lastAction,
    proof:state.proof?{serverSeedHash:state.proof.serverSeedHash,clientSeed:state.proof.clientSeed,nonce:state.proof.nonce,...(state.status==='finished'?{serverSeed:state.proof.serverSeed}:{})}:undefined,
    players:seatOrder(state.players).map(player=>{const profile=user(player.id);const reveal=player.id===userId||(showDown&&player.status!=='folded'&&player.status!=='out');return{...profile,seat:player.seat,stack:player.stack,status:player.status,streetBet:player.streetBet,totalBet:player.totalBet,hole:reveal?player.hole:[],cardsHidden:!reveal&&player.hole.length,isHost:player.id===state.hostUserId,isDealer:player.seat===state.buttonSeat,blind:player.seat===state.smallBlindSeat?'small':player.seat===state.bigBlindSeat?'big':undefined};}),
    me:me?{seat:me.seat,stack:me.stack,status:me.status}:'spectator',canAct:state.currentUserId===userId,toCall:me?Math.max(0,state.currentBet-me.streetBet):0,minRaiseTo:state.currentBet+state.minRaise,canStart:userId===state.hostUserId&&state.status!=='playing'&&state.players.filter(player=>player.stack>0).length>=MIN_PLAYERS,
    createdAt:state.createdAt,updatedAt:state.updatedAt,
  };
}

export function texasState(roomId:string,userId:string){const row=roomRow(roomId);if(!row)throw new Error('德州扑克牌桌不存在');return project(parseState(row),userId);}
export function texasRooms(spaceId:string,userId:string){
  const rows=db.prepare(`SELECT id,space_id AS spaceId,host_user_id AS hostUserId,small_blind AS smallBlind,buy_in AS buyIn,max_players AS maxPlayers,status,state_json AS stateJson,created_at AS createdAt,updated_at AS updatedAt FROM game_texas_rooms WHERE space_id=? AND status!='closed' ORDER BY CASE status WHEN 'playing' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,updated_at DESC LIMIT 30`).all(spaceId) as TexasRoomRow[];
  return rows.map(row=>{const state=parseState(row);return{roomId:row.id,status:state.status,smallBlind:state.smallBlind,bigBlind:state.bigBlind,buyIn:state.buyIn,maxPlayers:state.maxPlayers,players:state.players.map(player=>({...user(player.id),seat:player.seat,stack:player.stack})),handNumber:state.handNumber,pot:pot(state),updatedAt:state.updatedAt,isMine:state.players.some(player=>player.id===userId)};});
}

export function createTexasRoom(spaceId:string,userId:string,smallBlindValue:number,buyInValue:number,maxPlayersValue:number){
  if(activeRoom(userId))throw new Error('你已经在一张德州扑克牌桌中');
  const smallBlind=checkedWager(smallBlindValue,{multiple:10}),buyIn=checkedWager(buyInValue,{multiple:smallBlind});
  if(buyIn<smallBlind*20)throw new Error('带入筹码至少需要 20 个小盲');
  const maxPlayers=Math.max(MIN_PLAYERS,Math.min(MAX_PLAYERS,Math.trunc(maxPlayersValue)));const roomId=nanoid(10),now=Date.now();
  const state:TexasInternalState={roomId,spaceId,hostUserId:userId,smallBlind,bigBlind:smallBlind*2,buyIn,maxPlayers,status:'waiting',street:'waiting',handNumber:0,players:[{id:userId,seat:0,stack:buyIn,status:'active',streetBet:0,totalBet:0,hole:[],joinedAt:now}],currentBet:0,minRaise:smallBlind*2,pendingUserIds:[],community:[],deck:[],winners:[],createdAt:now,updatedAt:now};
  db.transaction(()=>{changeBalance(userId,-buyIn,'buy-in',GAME_ID,roomId);db.prepare(`INSERT INTO game_texas_rooms(id,space_id,host_user_id,small_blind,buy_in,max_players,status,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(roomId,spaceId,userId,smallBlind,buyIn,maxPlayers,state.status,JSON.stringify(state),now,now);})();
  emitWallet(userId);emit(state);return project(state,userId);
}

export function joinTexasRoom(roomId:string,spaceId:string,userId:string){
  const state=db.transaction(()=>{const row=roomRow(roomId);if(!row||row.spaceId!==spaceId||row.status==='closed')throw new Error('德州扑克牌桌不存在');const current=parseState(row);if(current.players.some(player=>player.id===userId))return current;if(activeRoom(userId))throw new Error('请先离开当前德州扑克牌桌');if(current.status==='playing')throw new Error('牌局已经开始，可以先进入观战');if(current.players.length>=current.maxPlayers)throw new Error('这张牌桌已经满员');changeBalance(userId,-current.buyIn,'buy-in',GAME_ID,roomId);const used=new Set(current.players.map(player=>player.seat));let seat=0;while(used.has(seat))seat++;current.players.push({id:userId,seat,stack:current.buyIn,status:'active',streetBet:0,totalBet:0,hole:[],joinedAt:Date.now()});if(current.status==='finished')current.street='waiting';current.status='waiting';return save(current);})();
  emitWallet(userId);emit(state);return project(state,userId);
}

export function watchTexasRoom(roomId:string,spaceId:string,userId:string){const row=roomRow(roomId);if(!row||row.spaceId!==spaceId||row.status==='closed')throw new Error('德州扑克牌桌不存在');return project(parseState(row),userId);}

export function startTexasHand(roomId:string,userId:string){
  const state=db.transaction(()=>{const row=roomRow(roomId);if(!row||row.status==='closed')throw new Error('德州扑克牌桌不存在');const current=parseState(row);if(current.hostUserId!==userId)throw new Error('只有房主可以开始牌局');if(current.status==='playing')throw new Error('牌局已经开始');const eligible=current.players.filter(player=>player.stack>0);if(eligible.length<MIN_PLAYERS)throw new Error('至少需要两位有筹码的玩家');
    current.handNumber++;current.handId=`${roomId}-${current.handNumber}-${nanoid(6)}`;current.proof=createFairSecret(`${roomId}:${current.handNumber}`);current.deck=shuffledDeck(new FairRandom(current.proof));current.community=[];current.winners=[];current.lastAction=undefined;current.status='playing';current.street='preflop';
    for(const player of current.players){player.status=player.stack>0?'active':'out';player.streetBet=0;player.totalBet=0;player.hole=[];}
    const active=current.players.filter(player=>player.status==='active');const previousButton=current.buttonSeat??-1;current.buttonSeat=nextSeat(active,previousButton)??active[0].seat;
    if(active.length===2){current.smallBlindSeat=current.buttonSeat;current.bigBlindSeat=nextSeat(active,current.buttonSeat)!;}else{current.smallBlindSeat=nextSeat(active,current.buttonSeat)!;current.bigBlindSeat=nextSeat(active,current.smallBlindSeat)!;}
    const dealStart=nextSeat(active,current.buttonSeat)!;let dealSeat=dealStart;
    for(let round=0;round<2;round++)for(let count=0;count<active.length;count++){const player=active.find(item=>item.seat===dealSeat)!;player.hole.push(current.deck.pop()!);dealSeat=nextSeat(active,dealSeat)!;}
    const small=active.find(player=>player.seat===current.smallBlindSeat)!;const big=active.find(player=>player.seat===current.bigBlindSeat)!;commit(small,current.smallBlind);commit(big,current.bigBlind);current.currentBet=Math.max(small.streetBet,big.streetBet);current.minRaise=current.bigBlind;current.pendingUserIds=actingPlayers(current).map(player=>player.id);setTurn(current,current.bigBlindSeat);if(current.pendingUserIds.length<=1)advanceStreet(current);return save(current);})();
  schedule(state);emit(state);return project(state,userId);
}

export function actTexas(roomId:string,userId:string,action:'fold'|'check'|'call'|'raise'|'all-in',raiseTo?:number){
  const state=db.transaction(()=>{const row=roomRow(roomId);if(!row)throw new Error('德州扑克牌桌不存在');const current=parseState(row);applyAction(current,userId,action,raiseTo);return save(current);})();
  schedule(state);emit(state);return project(state,userId);
}

export function expireTexasAction(roomId:string,userId:string,deadline:number){
  const row=roomRow(roomId);if(!row)return;const preview=parseState(row);if(preview.status!=='playing'||preview.currentUserId!==userId||preview.actionDeadline!==deadline||Date.now()<deadline)return;
  const player=preview.players.find(item=>item.id===userId);const action=player&&player.streetBet===preview.currentBet?'check':'fold';
  const state=db.transaction(()=>{const current=parseState(roomRow(roomId)!);if(current.currentUserId!==userId||current.actionDeadline!==deadline)return current;applyAction(current,userId,action);current.lastAction={userId,action:`timeout-${action}`,at:Date.now()};return save(current);})();schedule(state);emit(state);
}

export function leaveTexasRoom(roomId:string,userId:string){
  const result=db.transaction(()=>{const row=roomRow(roomId);if(!row||row.status==='closed')return undefined;const state=parseState(row);const player=state.players.find(item=>item.id===userId);if(!player)return state;if(state.status==='playing')throw new Error('牌局进行中，请先完成本手牌再离桌');if(player.stack>0)changeBalance(userId,player.stack,'cash-out',GAME_ID,roomId);state.players=state.players.filter(item=>item.id!==userId);if(!state.players.length){state.status='closed';save(state);return state;}if(state.hostUserId===userId)state.hostUserId=seatOrder(state.players)[0].id;state.status='waiting';state.street='waiting';return save(state);})();
  if(!result)return true;emitWallet(userId);emit(result,result.status==='closed');return true;
}

export function closeTexasRoom(roomId:string,userId:string){
  const state=db.transaction(()=>{const row=roomRow(roomId);if(!row||row.status==='closed')throw new Error('德州扑克牌桌不存在');const current=parseState(row);if(current.hostUserId!==userId)throw new Error('只有房主可以解散牌桌');if(current.status==='playing')throw new Error('牌局进行中不能解散牌桌');for(const player of current.players)if(player.stack>0){changeBalance(player.id,player.stack,'cash-out',GAME_ID,roomId);player.stack=0;}current.status='closed';return save(current);})();
  const timer=timers.get(roomId);if(timer)clearTimeout(timer);timers.delete(roomId);for(const player of state.players)emitWallet(player.id);emit(state,true);return true;
}

for(const row of db.prepare(`SELECT id,space_id AS spaceId,host_user_id AS hostUserId,small_blind AS smallBlind,buy_in AS buyIn,max_players AS maxPlayers,status,state_json AS stateJson,created_at AS createdAt,updated_at AS updatedAt FROM game_texas_rooms WHERE status='playing'`).all() as TexasRoomRow[])schedule(parseState(row));
