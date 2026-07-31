import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath=path.join(os.tmpdir(),`poio-chat-test-${process.pid}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.BACKUP_PATH=path.join(os.tmpdir(),`poio-chat-backups-${process.pid}`);
process.env.UPLOAD_PATH=path.join(os.tmpdir(),`poio-chat-uploads-${process.pid}`);
const database=await import('./database.js');

test('chat supports replies, editing, reactions, mentions, search and deletion',async()=>{
  const owner=await database.register(`chat_owner_${Date.now()}`,'Owner-chat-test');
  const guest=await database.register(`chat_guest_${Date.now()}`,'Guest-chat-test');
  const space=owner.bootstrap[0];
  const channelId=(space.channels.find((channel:any)=>channel.kind==='text') as {id:string}).id;
  const invite=database.createSpaceInvite(owner.user,space.id);
  database.joinSpace(guest.user,invite.code);

  const root=database.createMessage(owner.user,channelId,`欢迎 @${guest.user.username}`);
  assert.deepEqual(database.mentionedUserIds(channelId,root.body),[guest.user.id]);

  const reply=database.createMessage(guest.user,channelId,'收到',undefined,root.id);
  assert.equal(reply.reply?.id,root.id);
  assert.equal(reply.reply?.username,owner.user.username);

  const edited=database.editMessage(guest.user,reply.id,'已经收到');
  assert.equal(edited.body,'已经收到');
  assert.equal(typeof edited.editedAt,'number');
  assert.throws(()=>database.editMessage(owner.user,reply.id,'越权编辑'),/自己/);

  const reacted=database.toggleMessageReaction(owner.user,reply.id,'👍');
  assert.deepEqual(reacted.reactions,[{emoji:'👍',count:1,userIds:[owner.user.id]}]);
  assert.deepEqual(database.toggleMessageReaction(owner.user,reply.id,'👍').reactions,[]);

  const results=database.searchMessages(owner.user.id,channelId,'已经');
  assert.equal(results.length,1);
  assert.equal(results[0].id,reply.id);

  const deleted=database.deleteMessage(guest.user,reply.id);
  assert.equal(deleted.deleted,true);
  assert.equal(deleted.body,'');
  assert.throws(()=>database.toggleMessageReaction(owner.user,reply.id,'❤️'),/撤回/);
  const history=database.channelMessages(owner.user.id,channelId);
  assert.equal(history.find((message:any)=>message.id===root.id)?.reply,undefined);
  assert.equal(history.find((message:any)=>message.id===reply.id)?.deleted,true);
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
