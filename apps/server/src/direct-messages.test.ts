import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath=path.join(os.tmpdir(),`poio-dm-test-${process.pid}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.BACKUP_PATH=path.join(os.tmpdir(),`poio-dm-backups-${process.pid}`);
process.env.UPLOAD_PATH=path.join(os.tmpdir(),`poio-dm-uploads-${process.pid}`);
const database=await import('./database.js');

test('direct messages are private, realtime-ready and restricted to common communities',async()=>{
  const owner=await database.register(`dm_owner_${Date.now()}`,'Owner-direct-message-test');
  const alice=await database.register(`dm_alice_${Date.now()}`,'Alice-direct-message-test');
  const bob=await database.register(`dm_bob_${Date.now()}`,'Bob-direct-message-test');
  const outsider=await database.register(`dm_outsider_${Date.now()}`,'Outsider-direct-message-test');
  const space=owner.bootstrap[0];
  const invite=database.createSpaceInvite(owner.user,space.id);
  database.joinSpace(alice.user,invite.code);
  database.joinSpace(bob.user,invite.code);

  const first=database.createDirectMessage(alice.user,bob.user.id,'私聊你好');
  const attachment=database.createDirectMessage(bob.user,alice.user.id,'',{
    url:'/uploads/test.png',name:'截图.png',size:1024,mime:'image/png',
  });
  assert.equal(first.senderId,alice.user.id);
  assert.equal(attachment.attachmentName,'截图.png');
  assert.deepEqual(database.directMessages(alice.user.id,bob.user.id).map(message=>message.id),[first.id,attachment.id]);

  const unread=database.directConversations(alice.user.id).find(item=>item.user.id===bob.user.id);
  assert.equal(unread?.unreadCount,1);
  assert.equal(unread?.lastMessage.attachmentName,'截图.png');
  database.markDirectMessagesRead(alice.user.id,bob.user.id);
  assert.equal(database.directConversations(alice.user.id).find(item=>item.user.id===bob.user.id)?.unreadCount,0);

  assert.deepEqual(database.directMessages(owner.user.id,alice.user.id),[]);
  assert.throws(()=>database.directMessages(outsider.user.id,alice.user.id),/同一社区/);
  assert.throws(()=>database.createDirectMessage(alice.user,outsider.user.id,'越权'),/同一社区/);
  assert.throws(()=>database.createDirectMessage(alice.user,alice.user.id,'给自己'),/自己/);

  database.removeSpaceMember(owner.user,space.id,bob.user.id);
  assert.throws(()=>database.directMessages(alice.user.id,bob.user.id),/同一社区/);
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
