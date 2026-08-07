import { nanoid } from 'nanoid';
import { db, type PublicUser } from './database.js';
import { gameEvents, gameWallet } from './games.js';

const MAX_BALANCE=100_000_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS game_admin_audit (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_game_admin_audit_time ON game_admin_audit(created_at DESC);
`);

export type WalletAdminAction='add'|'set';

export function isGameAdmin(user:PublicUser,adminUsernames:string[]) {
  return adminUsernames.includes(user.username.toLocaleLowerCase('en-US'));
}

export function listGameWallets(query='',limit=50,offset=0) {
  const normalized=query.trim();
  const safeLimit=Math.max(1,Math.min(100,limit));
  const safeOffset=Math.max(0,offset);
  const where=normalized?'WHERE u.username LIKE ? COLLATE NOCASE':'';
  const params=normalized?[`%${normalized}%`]:[];
  const total=(db.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`).get(...params) as {total:number}).total;
  const users=db.prepare(`
    SELECT u.id,u.username,u.avatar_url AS avatarUrl,COALESCE(w.balance,10000) AS balance,
      COALESCE(w.updated_at,u.created_at) AS updatedAt
    FROM users u LEFT JOIN game_wallets w ON w.user_id=u.id
    ${where}
    ORDER BY u.username COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...params,safeLimit,safeOffset);
  return {users,total,limit:safeLimit,offset:safeOffset};
}

export function adjustGameWallet(admin:PublicUser,targetUserId:string,action:WalletAdminAction,value:number,reason:string) {
  const target=db.prepare('SELECT id,username,avatar_url AS avatarUrl FROM users WHERE id=?').get(targetUserId) as {id:string;username:string;avatarUrl?:string}|undefined;
  if(!target)throw new Error('目标用户不存在');
  const cleanReason=reason.trim();
  if(cleanReason.length<2||cleanReason.length>200)throw new Error('请填写 2–200 字的调整原因');
  if(!Number.isSafeInteger(value))throw new Error('积分必须是整数');
  if(action==='add'&&(value===0||Math.abs(value)>MAX_BALANCE))throw new Error('增减积分必须为非零整数');
  if(action==='set'&&(value<0||value>MAX_BALANCE))throw new Error(`积分余额必须在 0–${MAX_BALANCE.toLocaleString('zh-CN')} 之间`);

  const result=db.transaction(()=>{
    const before=gameWallet(target.id).balance;
    const after=action==='set'?value:before+value;
    if(after<0)throw new Error('扣除后积分不能小于 0');
    if(after>MAX_BALANCE)throw new Error('调整后积分超过余额上限');
    const amount=after-before;const now=Date.now();const auditId=nanoid();
    if(amount===0)throw new Error('新余额与当前余额相同');
    db.prepare('UPDATE game_wallets SET balance=?,updated_at=? WHERE user_id=?').run(after,now,target.id);
    db.prepare(`INSERT INTO game_ledger(id,user_id,amount,balance_after,kind,game,round_id,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(nanoid(),target.id,amount,after,action==='set'?'admin_set':'admin_adjust','admin',auditId,now);
    db.prepare(`INSERT INTO game_admin_audit(id,admin_user_id,target_user_id,action,amount,balance_before,balance_after,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(auditId,admin.id,target.id,action,amount,before,after,cleanReason,now);
    return {...target,balance:after,updatedAt:now,auditId,amount,before,after,reason:cleanReason,action};
  })();
  gameEvents.emit('wallet:update',{userId:target.id});
  return result;
}

export function gameAdminAudit(limit=50) {
  return db.prepare(`
    SELECT a.id,a.action,a.amount,a.balance_before AS balanceBefore,a.balance_after AS balanceAfter,
      a.reason,a.created_at AS createdAt,
      admin.id AS adminId,admin.username AS adminUsername,
      target.id AS targetId,target.username AS targetUsername
    FROM game_admin_audit a
    JOIN users admin ON admin.id=a.admin_user_id
    JOIN users target ON target.id=a.target_user_id
    ORDER BY a.created_at DESC,a.rowid DESC LIMIT ?
  `).all(Math.max(1,Math.min(200,limit)));
}
