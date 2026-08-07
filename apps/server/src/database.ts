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
if(!userColumns.some(column=>column.name==='join_sound_url'))db.exec('ALTER TABLE users ADD COLUMN join_sound_url TEXT');
if(!userColumns.some(column=>column.name==='leave_sound_url'))db.exec('ALTER TABLE users ADD COLUMN leave_sound_url TEXT');
const membershipColumns=db.prepare('PRAGMA table_info(memberships)').all() as Array<{name:string}>;
if(!membershipColumns.some(column=>column.name==='text_muted'))db.exec('ALTER TABLE memberships ADD COLUMN text_muted INTEGER NOT NULL DEFAULT 0');
if(!membershipColumns.some(column=>column.name==='voice_muted'))db.exec('ALTER TABLE memberships ADD COLUMN voice_muted INTEGER NOT NULL DEFAULT 0');
const messageColumns=db.prepare('PRAGMA table_info(messages)').all() as Array<{name:string}>;
if(!messageColumns.some(column=>column.name==='reply_to_id'))db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
if(!messageColumns.some(column=>column.name==='edited_at'))db.exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER');
if(!messageColumns.some(column=>column.name==='deleted_at'))db.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER');
db.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(message_id,user_id,emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id,created_at);
`);

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
export type PublicUser = { id: string; username: string; avatarUrl?:string; joinSoundUrl?:string; leaveSoundUrl?:string };
export type SpaceMember = PublicUser&{
  role:string;
  textMuted:boolean;
  voiceMuted:boolean;
};

function requireSpaceOwner(userId:string,spaceId:string) {
  const membership=db.prepare(`SELECT s.owner_id AS ownerId,m.role FROM spaces s
    JOIN memberships m ON m.space_id=s.id WHERE s.id=? AND m.user_id=?`)
    .get(spaceId,userId) as {ownerId:string;role:string}|undefined;
  if(!membership||membership.ownerId!==userId||membership.role!=='owner')
    throw new Error('只有社区拥有者可以执行此操作');
  return membership;
}

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
  const row = db.prepare('SELECT id,username,password_hash,avatar_url AS avatarUrl,join_sound_url AS joinSoundUrl,leave_sound_url AS leaveSoundUrl FROM users WHERE username=?').get(username) as { id: string; username: string; password_hash: string; avatarUrl?:string; joinSoundUrl?:string; leaveSoundUrl?:string } | undefined;
  if (!row || !(await argon2.verify(row.password_hash, password))) throw new Error('用户名或密码不正确');
  return issueSession({ id: row.id, username: row.username, avatarUrl:row.avatarUrl, joinSoundUrl:row.joinSoundUrl, leaveSoundUrl:row.leaveSoundUrl });
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
  return db.prepare(`SELECT u.id,u.username,u.avatar_url AS avatarUrl,u.join_sound_url AS joinSoundUrl,u.leave_sound_url AS leaveSoundUrl FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), Date.now()) as PublicUser | undefined;
}

export function updateAvatar(userId:string,avatarUrl:string|null) {
  if(avatarUrl&&!/^\/uploads\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(avatarUrl))throw new Error('头像文件格式无效');
  db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl,userId);
  return publicUserById(userId);
}

function publicUserById(userId:string) {
  return db.prepare('SELECT id,username,avatar_url AS avatarUrl,join_sound_url AS joinSoundUrl,leave_sound_url AS leaveSoundUrl FROM users WHERE id=?').get(userId) as PublicUser;
}

function validateVoiceSound(soundUrl:string|null,label:string) {
  if(soundUrl){
    if(!/^\/uploads\/[A-Za-z0-9_-]+\.(?:mp3|ogg|wav|m4a|aac|webm)$/i.test(soundUrl))throw new Error(`${label}仅支持 MP3、OGG、WAV、M4A、AAC 或 WebM`);
    const filename=path.basename(soundUrl);
    const soundPath=path.resolve(config.uploadPath,filename);
    if(path.dirname(soundPath)!==path.resolve(config.uploadPath)||!existsSync(soundPath))throw new Error(`${label}文件不存在`);
    const stats=statSync(soundPath);
    if(!stats.isFile()||stats.size>2*1024*1024)throw new Error(`${label}不能超过 2 MB`);
  }
}

export function updateJoinSound(userId:string,joinSoundUrl:string|null) {
  validateVoiceSound(joinSoundUrl,'加入提示音');
  db.prepare('UPDATE users SET join_sound_url=? WHERE id=?').run(joinSoundUrl,userId);
  return publicUserById(userId);
}

export function updateLeaveSound(userId:string,leaveSoundUrl:string|null) {
  validateVoiceSound(leaveSoundUrl,'退出提示音');
  db.prepare('UPDATE users SET leave_sound_url=? WHERE id=?').run(leaveSoundUrl,userId);
  return publicUserById(userId);
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
  requireSpaceOwner(user.id,spaceId);
  const space = db.prepare('SELECT name FROM spaces WHERE id=?').get(spaceId) as {name:string};
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
  const members=db.prepare(`SELECT u.id,u.username,u.avatar_url AS avatarUrl,u.join_sound_url AS joinSoundUrl,u.leave_sound_url AS leaveSoundUrl,
    m.role,m.text_muted AS textMuted,m.voice_muted AS voiceMuted
    FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.space_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.username COLLATE NOCASE`)
    .all(spaceId) as Array<Omit<SpaceMember,'textMuted'|'voiceMuted'>&{textMuted:number;voiceMuted:number}>;
  return members.map(member=>({
    ...member,
    textMuted:member.textMuted!==0,
    voiceMuted:member.voiceMuted!==0,
  }));
}

export function spaceMemberIds(spaceId:string) {
  return (db.prepare('SELECT user_id AS userId FROM memberships WHERE space_id=?').all(spaceId) as Array<{userId:string}>).map(row=>row.userId);
}

export function createChannel(user: PublicUser, spaceId: string, name: string, kind: 'text'|'voice') {
  requireSpaceOwner(user.id,spaceId);
  const id = nanoid();
  const position = (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS value FROM channels WHERE space_id=?').get(spaceId) as {value:number}).value;
  db.prepare('INSERT INTO channels(id,space_id,name,kind,position,created_at) VALUES(?,?,?,?,?,?)').run(id, spaceId, name, kind, position, Date.now());
  return { id, spaceId, name, kind, position };
}

const messageSelect=`SELECT m.id,m.channel_id AS channelId,m.body,m.created_at AS createdAt,
  m.edited_at AS editedAt,m.deleted_at AS deletedAt,
  m.attachment_url AS attachmentUrl,m.attachment_name AS attachmentName,
  m.attachment_size AS attachmentSize,m.attachment_mime AS attachmentMime,
  u.id AS userId,u.username,u.avatar_url AS avatarUrl,
  rm.id AS replyId,rm.body AS replyBody,rm.deleted_at AS replyDeletedAt,
  rm.attachment_name AS replyAttachmentName,
  ru.id AS replyUserId,ru.username AS replyUsername
  FROM messages m JOIN users u ON u.id=m.user_id
  LEFT JOIN messages rm ON rm.id=m.reply_to_id
  LEFT JOIN users ru ON ru.id=rm.user_id`;

function hydrateMessages(rows:any[]) {
  if(!rows.length)return [];
  const placeholders=rows.map(()=>'?').join(',');
  const reactions=db.prepare(`SELECT message_id AS messageId,user_id AS userId,emoji
    FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY created_at`)
    .all(...rows.map(row=>row.id)) as Array<{messageId:string;userId:string;emoji:string}>;
  const grouped=new Map<string,Map<string,string[]>>();
  for(const reaction of reactions){
    let byEmoji=grouped.get(reaction.messageId);
    if(!byEmoji){byEmoji=new Map();grouped.set(reaction.messageId,byEmoji)}
    const userIds=byEmoji.get(reaction.emoji)??[];
    userIds.push(reaction.userId);
    byEmoji.set(reaction.emoji,userIds);
  }
  return rows.map(row=>{
    const reply=row.replyId?{
      id:row.replyId,
      userId:row.replyUserId,
      username:row.replyUsername,
      body:row.replyDeletedAt?'' : row.replyBody,
      attachmentName:row.replyDeletedAt?undefined:normalizeAttachmentName(row.replyAttachmentName),
      deleted:Boolean(row.replyDeletedAt),
    }:undefined;
    const byEmoji=grouped.get(row.id);
    return {
      id:row.id,channelId:row.channelId,body:row.deletedAt?'':row.body,createdAt:row.createdAt,
      editedAt:row.deletedAt?undefined:row.editedAt??undefined,deleted:Boolean(row.deletedAt),
      userId:row.userId,username:row.username,avatarUrl:row.avatarUrl??undefined,
      attachmentUrl:row.deletedAt?undefined:row.attachmentUrl??undefined,
      attachmentName:row.deletedAt?undefined:normalizeAttachmentName(row.attachmentName)??undefined,
      attachmentSize:row.deletedAt?undefined:row.attachmentSize??undefined,
      attachmentMime:row.deletedAt?undefined:row.attachmentMime??undefined,
      reply,
      reactions:byEmoji?[...byEmoji.entries()].map(([emoji,userIds])=>({emoji,count:userIds.length,userIds})):[],
    };
  });
}

function requireChannelAccess(userId:string,channelId:string) {
  const allowed = db.prepare(`SELECT 1 FROM channels c JOIN memberships m ON m.space_id=c.space_id
    WHERE c.id=? AND m.user_id=?`).get(channelId, userId);
  if (!allowed) throw new Error('无法访问该频道');
}

function hydratedMessage(userId:string,messageId:string) {
  const row=db.prepare(`${messageSelect}
    JOIN channels access_channel ON access_channel.id=m.channel_id
    JOIN memberships access_membership ON access_membership.space_id=access_channel.space_id
    WHERE m.id=? AND access_membership.user_id=?`).get(messageId,userId);
  if(!row)throw new Error('消息不存在或无法访问');
  return hydrateMessages([row])[0];
}

export function channelMessages(userId: string, channelId: string) {
  requireChannelAccess(userId,channelId);
  const rows=db.prepare(`${messageSelect}
    WHERE m.channel_id=? ORDER BY m.created_at DESC LIMIT 200`).all(channelId).reverse();
  return hydrateMessages(rows);
}

export function voiceChannelForUser(userId:string,channelId:string) {
  const channel=db.prepare(`SELECT c.id,c.name,c.space_id AS spaceId,m.voice_muted AS voiceMuted
    FROM channels c JOIN memberships m ON m.space_id=c.space_id
    WHERE c.id=? AND c.kind='voice' AND m.user_id=?`).get(channelId,userId) as {id:string;name:string}|undefined;
  if(!channel)throw new Error('无法访问该语音频道');
  return {
    ...channel,
    voiceMuted:Boolean((channel as {voiceMuted?:number}).voiceMuted),
  };
}

export function createMessage(user: PublicUser, channelId: string, body: string, attachment?: {url:string;name:string;size:number;mime:string},replyToId?:string) {
  const allowed = db.prepare(`SELECT m.text_muted AS textMuted FROM channels c JOIN memberships m ON m.space_id=c.space_id
    WHERE c.id=? AND m.user_id=?`).get(channelId, user.id) as {textMuted:number}|undefined;
  if (!allowed) throw new Error('无法访问该频道');
  if(allowed.textMuted!==0)throw new Error('你已被社区拥有者禁言');
  if(replyToId){
    const reply=db.prepare('SELECT channel_id AS channelId FROM messages WHERE id=?').get(replyToId) as {channelId:string}|undefined;
    if(!reply||reply.channelId!==channelId)throw new Error('回复的消息不存在或不在当前频道');
  }
  const attachmentName=normalizeAttachmentName(attachment?.name);
  const message = { id: nanoid(), channelId, body, createdAt: Date.now(), userId: user.id, username: user.username,
    avatarUrl:user.avatarUrl,attachmentUrl:attachment?.url,attachmentName,attachmentSize:attachment?.size,attachmentMime:attachment?.mime };
  db.prepare(`INSERT INTO messages(id,channel_id,user_id,body,created_at,attachment_url,attachment_name,attachment_size,attachment_mime,reply_to_id)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(message.id, channelId, user.id, body, message.createdAt, attachment?.url??null, attachmentName??null, attachment?.size??null, attachment?.mime??null, replyToId??null);
  return hydratedMessage(user.id,message.id);
}

export function editMessage(user:PublicUser,messageId:string,body:string) {
  const row=db.prepare(`SELECT m.user_id AS userId,m.channel_id AS channelId,m.attachment_url AS attachmentUrl,
    m.deleted_at AS deletedAt,member.text_muted AS textMuted
    FROM messages m JOIN channels c ON c.id=m.channel_id
    JOIN memberships member ON member.space_id=c.space_id AND member.user_id=?
    WHERE m.id=?`).get(user.id,messageId) as {userId:string;channelId:string;attachmentUrl?:string;deletedAt?:number;textMuted:number}|undefined;
  if(!row)throw new Error('消息不存在或无法访问');
  if(row.userId!==user.id)throw new Error('只能编辑自己发送的消息');
  if(row.deletedAt)throw new Error('消息已经撤回');
  if(row.textMuted!==0)throw new Error('你已被社区拥有者禁言');
  if(!body&& !row.attachmentUrl)throw new Error('消息不能为空');
  db.prepare('UPDATE messages SET body=?,edited_at=? WHERE id=?').run(body,Date.now(),messageId);
  return hydratedMessage(user.id,messageId);
}

export function deleteMessage(user:PublicUser,messageId:string) {
  const row=db.prepare(`SELECT m.user_id AS userId,m.channel_id AS channelId,m.deleted_at AS deletedAt,s.owner_id AS ownerId
    FROM messages m JOIN channels c ON c.id=m.channel_id JOIN spaces s ON s.id=c.space_id
    JOIN memberships member ON member.space_id=s.id AND member.user_id=?
    WHERE m.id=?`).get(user.id,messageId) as {userId:string;channelId:string;deletedAt?:number;ownerId:string}|undefined;
  if(!row)throw new Error('消息不存在或无法访问');
  if(row.userId!==user.id&&row.ownerId!==user.id)throw new Error('只能撤回自己的消息');
  if(!row.deletedAt){
    db.transaction(()=>{
      db.prepare(`UPDATE messages SET body='',attachment_url=NULL,attachment_name=NULL,attachment_size=NULL,
        attachment_mime=NULL,edited_at=NULL,deleted_at=? WHERE id=?`).run(Date.now(),messageId);
      db.prepare('DELETE FROM message_reactions WHERE message_id=?').run(messageId);
    })();
  }
  return hydratedMessage(user.id,messageId);
}

const supportedReactions=new Set(['👍','❤️','😂','😮','😢','😡','🎉','👏','🔥','✅','❌','👀']);
export function toggleMessageReaction(user:PublicUser,messageId:string,emoji:string) {
  if(!supportedReactions.has(emoji))throw new Error('不支持该表情回应');
  const row=db.prepare(`SELECT m.channel_id AS channelId,m.deleted_at AS deletedAt,member.text_muted AS textMuted
    FROM messages m JOIN channels c ON c.id=m.channel_id
    JOIN memberships member ON member.space_id=c.space_id AND member.user_id=?
    WHERE m.id=?`).get(user.id,messageId) as {channelId:string;deletedAt?:number;textMuted:number}|undefined;
  if(!row)throw new Error('消息不存在或无法访问');
  if(row.deletedAt)throw new Error('无法回应已撤回的消息');
  if(row.textMuted!==0)throw new Error('你已被社区拥有者禁言');
  const existing=db.prepare('SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').get(messageId,user.id,emoji);
  if(existing)db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').run(messageId,user.id,emoji);
  else db.prepare('INSERT INTO message_reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)').run(messageId,user.id,emoji,Date.now());
  return hydratedMessage(user.id,messageId);
}

export function searchMessages(userId:string,channelId:string,query:string) {
  requireChannelAccess(userId,channelId);
  const escaped=query.replace(/[\\%_]/g,value=>`\\${value}`);
  const pattern=`%${escaped}%`;
  const rows=db.prepare(`${messageSelect}
    WHERE m.channel_id=? AND m.deleted_at IS NULL
      AND (m.body LIKE ? ESCAPE '\\' OR m.attachment_name LIKE ? ESCAPE '\\')
    ORDER BY m.created_at DESC LIMIT 50`).all(channelId,pattern,pattern);
  return hydrateMessages(rows);
}

export function mentionedUserIds(channelId:string,body:string) {
  if(!body.includes('@'))return [];
  const members=db.prepare(`SELECT u.id,u.username FROM channels c JOIN memberships m ON m.space_id=c.space_id
    JOIN users u ON u.id=m.user_id WHERE c.id=?`).all(channelId) as Array<{id:string;username:string}>;
  const normalized=body.toLocaleLowerCase('zh-CN');
  return members.filter(member=>{
    const mention=`@${member.username.toLocaleLowerCase('zh-CN')}`;
    let index=normalized.indexOf(mention);
    while(index>=0){
      const next=normalized[index+mention.length];
      if(!next||/[\s,，。.!！?？:：;；、)\]}]/u.test(next))return true;
      index=normalized.indexOf(mention,index+mention.length);
    }
    return false;
  }).map(member=>member.id);
}

export function channelSpaceId(channelId:string) {
  return (db.prepare('SELECT space_id AS spaceId FROM channels WHERE id=?').get(channelId) as {spaceId:string}|undefined)?.spaceId;
}

export function renameSpace(user:PublicUser,spaceId:string,name:string) {
  requireSpaceOwner(user.id,spaceId);
  db.prepare('UPDATE spaces SET name=? WHERE id=?').run(name,spaceId);
  return {spaceId,name};
}

export function updateMemberModeration(
  user:PublicUser,
  spaceId:string,
  targetUserId:string,
  changes:{textMuted?:boolean;voiceMuted?:boolean},
) {
  requireSpaceOwner(user.id,spaceId);
  const target=db.prepare('SELECT role FROM memberships WHERE space_id=? AND user_id=?')
    .get(spaceId,targetUserId) as {role:string}|undefined;
  if(!target)throw new Error('该成员已不在社区中');
  if(target.role==='owner'||targetUserId===user.id)throw new Error('不能限制社区拥有者');
  const current=db.prepare('SELECT text_muted AS textMuted,voice_muted AS voiceMuted FROM memberships WHERE space_id=? AND user_id=?')
    .get(spaceId,targetUserId) as {textMuted:number;voiceMuted:number};
  const textMuted=changes.textMuted??(current.textMuted!==0);
  const voiceMuted=changes.voiceMuted??(current.voiceMuted!==0);
  db.prepare('UPDATE memberships SET text_muted=?,voice_muted=? WHERE space_id=? AND user_id=?')
    .run(textMuted?1:0,voiceMuted?1:0,spaceId,targetUserId);
  return {spaceId,userId:targetUserId,textMuted,voiceMuted};
}

export function removeSpaceMember(user:PublicUser,spaceId:string,targetUserId:string) {
  requireSpaceOwner(user.id,spaceId);
  const target=db.prepare('SELECT role FROM memberships WHERE space_id=? AND user_id=?')
    .get(spaceId,targetUserId) as {role:string}|undefined;
  if(!target)throw new Error('该成员已不在社区中');
  if(target.role==='owner'||targetUserId===user.id)throw new Error('不能移除社区拥有者');
  db.prepare('DELETE FROM memberships WHERE space_id=? AND user_id=?').run(spaceId,targetUserId);
  return {spaceId,userId:targetUserId};
}

export function renameChannel(user:PublicUser,channelId:string,name:string) {
  const channel=db.prepare('SELECT id,space_id AS spaceId,kind,position FROM channels WHERE id=?')
    .get(channelId) as {id:string;spaceId:string;kind:'text'|'voice';position:number}|undefined;
  if(!channel)throw new Error('频道不存在');
  requireSpaceOwner(user.id,channel.spaceId);
  db.prepare('UPDATE channels SET name=? WHERE id=?').run(name,channelId);
  return {...channel,name};
}

export function deleteChannel(user:PublicUser,channelId:string) {
  const channel=db.prepare('SELECT id,space_id AS spaceId,name,kind,position FROM channels WHERE id=?')
    .get(channelId) as {id:string;spaceId:string;name:string;kind:'text'|'voice';position:number}|undefined;
  if(!channel)throw new Error('频道不存在');
  requireSpaceOwner(user.id,channel.spaceId);
  const count=(db.prepare('SELECT COUNT(*) AS count FROM channels WHERE space_id=? AND kind=?')
    .get(channel.spaceId,channel.kind) as {count:number}).count;
  if(count<=1)throw new Error(`社区至少需要保留一个${channel.kind==='voice'?'语音':'文字'}频道`);
  db.prepare('DELETE FROM channels WHERE id=?').run(channelId);
  return channel;
}
