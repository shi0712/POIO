import { Check, CircleDot, Coins, Eye, LogOut, Play, Sparkles, Swords, UserPlus, X } from 'lucide-react';
import gomokuCover from '../../assets/games/gomoku-cover.svg';
import { BetControls, formatPoints, GameStage } from '../shared/components';
import type { GameInviteMember } from '../shared/types';
import type { GomokuRoom, GomokuState } from './types';

export function GomokuGame({state,rooms,wager,setWager,busy,onCreate,onOpen,onMove,onResign,onRematch,onLeave,onInvite}:{state?:GomokuState;rooms:GomokuRoom[];wager:number;setWager:(value:number)=>void;busy:boolean;onCreate:()=>void;onOpen:(room:GomokuRoom)=>void;onMove:(cell:number)=>void;onResign:()=>void;onRematch:()=>void;onLeave:()=>void;onInvite:()=>void}){
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

export function GomokuInvitePicker({members,invited,now,busy,wager,onInvite,onClose}:{members:GameInviteMember[];invited:Record<string,number>;now:number;busy:string;wager:number;onInvite:(member:GameInviteMember)=>void;onClose:()=>void}){
  return <div className="gomoku-invite-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="gomoku-invite-picker"><header><div><UserPlus/><span><b>邀请在线成员</b><small>对方加入时将支付 {formatPoints(wager)} 积分</small></span></div><button onClick={onClose}><X/></button></header><div className="gomoku-invite-members">{members.length===0?<div className="gomoku-invite-empty"><UserPlus/><b>暂时没有可邀请的在线成员</b><span>成员上线后会自动出现在这里。</span></div>:members.map(member=>{const resendAt=invited[member.id]??0;const cooling=resendAt>now;return <article key={member.id}><div className="gomoku-invite-avatar">{member.avatarUrl?<img src={member.avatarUrl} alt=""/>:member.username.slice(0,1).toUpperCase()}</div><span><b>{member.username}</b><small><i/>在线</small></span><button disabled={!!busy||cooling} onClick={()=>onInvite(member)}>{busy===member.id?'发送中…':cooling?<><Check/>已邀请 {Math.ceil((resendAt-now)/1000)}s</>:resendAt?<><UserPlus/>重新邀请</>:<><UserPlus/>邀请</>}</button></article>})}</div></section></div>;
}
