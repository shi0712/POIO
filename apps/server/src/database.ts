import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { config } from './config.js';

mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY(space_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS space_invites (
    code TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text','voice')),
    position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL,
    attachment_url TEXT, attachment_name TEXT, attachment_size INTEGER, attachment_mime TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at);
`);
const userColumns=db.prepare('PRAGMA table_info(users)').all() as Array<{name:string}>;
if(!userColumns.some(column=>column.name==='avatar_url'))db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');

const backupName=/^poio-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;
let backupRunning=false;

function backupFiles() {
  mkdirSync(path.resolve(config.backupPath),{recursive:true});
  return readdirSync(path.resolve(config.backupPath))
    .filter(name=>backupName.test(name))
    .map(name=>({name,path:path.join(path.resolve(config.backupPath),name),modified:statSync(path.join(path.resolve(config.backupPath),name)).mtimeMs}));
}

export async function runDatabaseBackup(force=false) {
  if(backupRunning)return undefined;
  const files=backupFiles();
  const intervalMs=Math.max(.25,config.backupIntervalHours)*3_600_000;
  if(!force&&files.some(file=>Date.now()-file.modified<intervalMs))return undefined;
  backupRunning=true;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const destination=path.join(path.resolve(config.backupPath),`poio-${stamp}.db`);
  const temporary=`${destination}.tmp`;
  try{
    await db.backup(temporary);
    renameSync(temporary,destination);
    const cutoff=Date.now()-Math.max(1,config.backupRetentionDays)*86_400_000;
    for(const file of backupFiles())if(file.modified<cutoff&&file.path!==destination)unlinkSync(file.path);
    return destination;
  }finally{
    backupRunning=false;
    if(existsSync(temporary))unlinkSync(temporary);
  }
}

export function scheduleDatabaseBackups() {
  const run=()=>void runDatabaseBackup().then(file=>{if(file)console.log(`POIO database backup created: ${file}`)}).catch(error=>console.error('POIO database backup failed',error));
  run();
  const timer=setInterval(run,Math.max(.25,config.backupIntervalHours)*3_600_000);
  timer.unref();
  return timer;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export type PublicUser = { id: string; username: string; avatarUrl?:string };

function normalizeAttachmentName(value:string|null|undefined) {
  if(!value)return value;
  let name=value;
  const latin1=[...value].every(character=>(character.codePointAt(0)??0)<=255);
  const decoded=latin1?Buffer.from(value,'latin1').toString('utf8'):value;
  if(latin1&&!decoded.includes('\uFFFD')&&decoded!==value&&/[^\x00-\x7F]/.test(decoded))name=decoded;
  return name.normalize('NFC').replace(/[\u0000-\u001F\u007F]/g,'').trim()||'file';
}

export async function register(username: string, password: string) {
  const id = nanoid();
  const now = Date.now();
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });
  const spaceId = nanoid();
  const transaction = db.transaction(() => {
    db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(id, username, hash, now);
    db.prepare('INSERT INTO spaces(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(spaceId, `${username} 的社区`, id, now);
    db.prepare("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'owner')").run(spaceId, id);
    const add = db.prepare('INSERT INTO channels(id,space_id,name,kind,position,created_at) VALUES(?,?,?,?,?,?)');
    add.run(nanoid(), spaceId, '欢迎', 'text', 0, now);
    add.run(nanoid(), spaceId, '大厅', 'voice', 1, now);
  });
  transaction();
  return issueSession({ id, username });
}

export async function login(username: string, password: string) {
  const row = db.prepare('SELECT id,username,password_hash,avatar_url AS avatarUrl FROM users WHERE username=?').get(username) as { id: string; username: string; password_hash: string; avatarUrl?:string } | undefined;
  if (!row || !(await argon2.verify(row.password_hash, password))) throw new Error('用户名或密码不正确');
  return issueSession({ id: row.id, username: row.username });
}

function issueSession(user: PublicUser) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + config.sessionDays * 86_400_000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token), user.id, expiresAt);
  return { token, user, bootstrap: bootstrap(user.id) };
}

export function resume(token: string) {
  const row = userFromToken(token);
  if (!row) throw new Error('登录已过期，请重新登录');
  return { token, user: row, bootstrap: bootstrap(row.id) };
}

export function userFromToken(token: string) {
  return db.prepare(`SELECT u.id,u.username,u.avatar_url AS avatarUrl FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), Date.now()) as PublicUser | undefined;
}

export function updateAvatar(userId:string,avatarUrl:string|null) {
  if(avatarUrl&&!/^\/uploads\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(avatarUrl))throw new Error('头像文件格式无效');
  db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl,userId);
  return db.prepare('SELECT id,username,avatar_url AS avatarUrl FROM users WHERE id=?').get(userId) as PublicUser;
}

export function revokeSession(token:string) {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
}

export function bootstrap(userId: string) {
  const spaces = db.prepare(`SELECT s.id,s.name,s.owner_id AS ownerId FROM spaces s
    JOIN memberships m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.created_at`).all(userId) as Array<{id:string;name:string;ownerId:string}>;
  return spaces.map((space) => ({
    ...space,
    channels: db.prepare('SELECT id,name,kind,position FROM channels WHERE space_id=? ORDER BY position,created_at').all(space.id)
  }));
}

export function createSpace(user: PublicUser, name: string) {
  const id = nanoid(); const now = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO spaces(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(id, name, user.id, now);
    db.prepare("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'owner')").run(id, user.id);
    db.prepare('INSERT INTO channels(id,space_id,name,kind,position,created_at) VALUES(?,?,?,?,?,?)').run(nanoid(), id, '欢迎', 'text', 0, now);
    db.prepare('INSERT INTO channels(id,space_id,name,kind,position,created_at) VALUES(?,?,?,?,?,?)').run(nanoid(), id, '大厅', 'voice', 1, now);
  })();
  return bootstrap(user.id).find((space) => space.id === id)!;
}

export function createSpaceInvite(user: PublicUser, spaceId: string) {
  const space = db.prepare(`SELECT s.name,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id
    WHERE s.id=? AND m.user_id=?`).get(spaceId,user.id) as {name:string;role:string}|undefined;
  if(!space||!['owner','admin'].includes(space.role))throw new Error('只有社区拥有者或管理员可以邀请成员');
  const now=Date.now();
  const existing=db.prepare('SELECT code,expires_at AS expiresAt FROM space_invites WHERE space_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 1').get(spaceId,now) as {code:string;expiresAt:number}|undefined;
  if(existing)return {...existing,spaceId,spaceName:space.name};
  const code=randomBytes(5).toString('hex').toUpperCase();
  const expiresAt=now+30*86_400_000;
  db.prepare('INSERT INTO space_invites(code,space_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?)').run(code,spaceId,user.id,now,expiresAt);
  return {code,spaceId,spaceName:space.name,expiresAt};
}

function normalizeInviteCode(rawCode:string) {
  const value=rawCode.trim().toUpperCase();
  if(/^[A-F0-9]{10}$/.test(value))return value;
  const match=value.match(/(?:POIO:\/\/INVITE\/|\/INVITE\/)([A-F0-9]{10})(?:[/?#]|$)/);
  if(!match)throw new Error('邀请链接或邀请码格式不正确');
  return match[1];
}

export function previewSpaceInvite(rawCode:string) {
  const code=normalizeInviteCode(rawCode);
  const invite=db.prepare(`SELECT i.code,i.space_id AS spaceId,s.name AS spaceName,i.expires_at AS expiresAt,
    (SELECT COUNT(*) FROM memberships m WHERE m.space_id=i.space_id) AS memberCount
    FROM space_invites i JOIN spaces s ON s.id=i.space_id
    WHERE i.code=? AND i.expires_at>?`).get(code,Date.now()) as {code:string;spaceId:string;spaceName:string;expiresAt:number;memberCount:number}|undefined;
  if(!invite)throw new Error('邀请链接不存在或已过期');
  return invite;
}

export function joinSpace(user: PublicUser, rawCode: string) {
  const preview=previewSpaceInvite(rawCode);
  const invite={spaceId:preview.spaceId,name:preview.spaceName};
  db.prepare("INSERT OR IGNORE INTO memberships(space_id,user_id,role) VALUES(?,?,'member')").run(invite.spaceId,user.id);
  return bootstrap(user.id).find(space=>space.id===invite.spaceId)!;
}

export function spaceMembers(userId:string,spaceId:string) {
  const allowed=db.prepare('SELECT 1 FROM memberships WHERE space_id=? AND user_id=?').get(spaceId,userId);
  if(!allowed)throw new Error('无法访问该社区');
  return db.prepare(`SELECT u.id,u.username,u.avatar_url AS avatarUrl,m.role FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.space_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.username COLLATE NOCASE`).all(spaceId);
}

export function spaceMemberIds(spaceId:string) {
  return (db.prepare('SELECT user_id AS userId FROM memberships WHERE space_id=?').all(spaceId) as Array<{userId:string}>).map(row=>row.userId);
}

export function createChannel(user: PublicUser, spaceId: string, name: string, kind: 'text'|'voice') {
  const membership = db.prepare('SELECT role FROM memberships WHERE space_id=? AND user_id=?').get(spaceId, user.id) as {role:string}|undefined;
  if (!membership || !['owner','admin'].includes(membership.role)) throw new Error('没有创建频道的权限');
  const id = nanoid();
  const position = (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS value FROM channels WHERE space_id=?').get(spaceId) as {value:number}).value;
  db.prepare('INSERT INTO channels(id,space_id,name,kind,position,created_at) VALUES(?,?,?,?,?,?)').run(id, spaceId, name, kind, position, Date.now());
  return { id, spaceId, name, kind, position };
}

export function channelMessages(userId: string, channelId: string) {
  const allowed = db.prepare(`SELECT 1 FROM channels c JOIN memberships m ON m.space_id=c.space_id
    WHERE c.id=? AND m.user_id=?`).get(channelId, userId);
  if (!allowed) throw new Error('无法访问该频道');
  const rows=db.prepare(`SELECT m.id,m.channel_id AS channelId,m.body,m.created_at AS createdAt,
    m.attachment_url AS attachmentUrl,m.attachment_name AS attachmentName,
    m.attachment_size AS attachmentSize,m.attachment_mime AS attachmentMime,
    u.id AS userId,u.username,u.avatar_url AS avatarUrl FROM messages m JOIN users u ON u.id=m.user_id
    WHERE m.channel_id=? ORDER BY m.created_at DESC LIMIT 200`).all(channelId).reverse();
  return rows.map((row:any)=>({...row,attachmentName:normalizeAttachmentName(row.attachmentName)}));
}

export function voiceChannelForUser(userId:string,channelId:string) {
  const channel=db.prepare(`SELECT c.id,c.name FROM channels c JOIN memberships m ON m.space_id=c.space_id
    WHERE c.id=? AND c.kind='voice' AND m.user_id=?`).get(channelId,userId) as {id:string;name:string}|undefined;
  if(!channel)throw new Error('无法访问该语音频道');
  return channel;
}

export function createMessage(user: PublicUser, channelId: string, body: string, attachment?: {url:string;name:string;size:number;mime:string}) {
  const allowed = db.prepare(`SELECT 1 FROM channels c JOIN memberships m ON m.space_id=c.space_id
    WHERE c.id=? AND m.user_id=?`).get(channelId, user.id);
  if (!allowed) throw new Error('无法访问该频道');
  const attachmentName=normalizeAttachmentName(attachment?.name);
  const message = { id: nanoid(), channelId, body, createdAt: Date.now(), userId: user.id, username: user.username,
    avatarUrl:user.avatarUrl,attachmentUrl:attachment?.url,attachmentName,attachmentSize:attachment?.size,attachmentMime:attachment?.mime };
  db.prepare(`INSERT INTO messages(id,channel_id,user_id,body,created_at,attachment_url,attachment_name,attachment_size,attachment_mime)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(message.id, channelId, user.id, body, message.createdAt, attachment?.url??null, attachmentName??null, attachment?.size??null, attachment?.mime??null);
  return message;
}

export function channelSpaceId(channelId:string) {
  return (db.prepare('SELECT space_id AS spaceId FROM channels WHERE id=?').get(channelId) as {spaceId:string}|undefined)?.spaceId;
}
