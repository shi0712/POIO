import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath=path.join(os.tmpdir(),`poio-invite-test-${process.pid}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.BACKUP_PATH=path.join(os.tmpdir(),`poio-invite-backups-${process.pid}`);
process.env.UPLOAD_PATH=path.join(os.tmpdir(),`poio-uploads-${process.pid}`);
const database=await import('./database.js');

test('community invite preview accepts codes and share links',async()=>{
  const ownerAuth=await database.register(`owner_${Date.now()}`,'Owner-invite-test');
  const guestAuth=await database.register(`guest_${Date.now()}`,'Guest-invite-test');
  const sourceSpace=ownerAuth.bootstrap[0];
  const invite=database.createSpaceInvite(ownerAuth.user,sourceSpace.id);
  const direct=database.previewSpaceInvite(invite.code);
  const web=database.previewSpaceInvite(`https://115.159.222.29/poio/invite/${invite.code}`);
  const deep=database.previewSpaceInvite(`poio://invite/${invite.code}`);
  assert.equal(direct.spaceId,sourceSpace.id);
  assert.equal(direct.memberCount,1);
  assert.deepEqual(web,direct);
  assert.deepEqual(deep,direct);
  const joined=database.joinSpace(guestAuth.user,`https://115.159.222.29/poio/invite/${invite.code}`);
  assert.equal(joined.id,sourceSpace.id);
  assert.equal(database.previewSpaceInvite(invite.code).memberCount,2);
});

test('custom join sounds are stored with the user and size-limited',async()=>{
  const auth=await database.register(`cue_${Date.now()}`,'Join-sound-test');
  mkdirSync(process.env.UPLOAD_PATH!,{recursive:true});
  writeFileSync(path.join(process.env.UPLOAD_PATH!,'valid.mp3'),Buffer.alloc(1024));
  const updated=database.updateJoinSound(auth.user.id,'/uploads/valid.mp3');
  assert.equal(updated.joinSoundUrl,'/uploads/valid.mp3');
  assert.equal(database.userFromToken(auth.token)?.joinSoundUrl,'/uploads/valid.mp3');
  assert.throws(()=>database.updateJoinSound(auth.user.id,'/uploads/missing.mp3'),/不存在/);
  writeFileSync(path.join(process.env.UPLOAD_PATH!,'too-large.mp3'),Buffer.alloc(2*1024*1024+1));
  assert.throws(()=>database.updateJoinSound(auth.user.id,'/uploads/too-large.mp3'),/2 MB/);
  assert.equal(database.updateJoinSound(auth.user.id,null).joinSoundUrl,null);
});

test('only the community owner can moderate members and manage channels',async()=>{
  const owner=await database.register(`moderator_${Date.now()}`,'Owner-moderation-test');
  const guest=await database.register(`member_${Date.now()}`,'Guest-moderation-test');
  const space=owner.bootstrap[0];
  const initialTextChannelId=(space.channels[0] as {id:string}).id;
  const invite=database.createSpaceInvite(owner.user,space.id);
  database.joinSpace(guest.user,invite.code);

  const muted=database.updateMemberModeration(owner.user,space.id,guest.user.id,{textMuted:true,voiceMuted:true});
  assert.deepEqual(muted,{spaceId:space.id,userId:guest.user.id,textMuted:true,voiceMuted:true});
  assert.equal(database.spaceMembers(owner.user.id,space.id).find(member=>member.id===guest.user.id)?.voiceMuted,true);
  assert.throws(()=>database.createMessage(guest.user,initialTextChannelId,'blocked'),/禁言/);
  assert.throws(()=>database.updateMemberModeration(guest.user,space.id,owner.user.id,{textMuted:true}),/拥有者/);

  database.updateMemberModeration(owner.user,space.id,guest.user.id,{textMuted:false,voiceMuted:false});
  assert.equal(database.createMessage(guest.user,initialTextChannelId,'allowed').body,'allowed');

  const extraText=database.createChannel(owner.user,space.id,'攻略','text');
  const renamed=database.renameChannel(owner.user,extraText.id,'战术');
  assert.equal(renamed.name,'战术');
  assert.throws(()=>database.renameChannel(guest.user,extraText.id,'越权'),/拥有者/);
  assert.equal(database.deleteChannel(owner.user,extraText.id).id,extraText.id);
  assert.throws(()=>database.deleteChannel(owner.user,initialTextChannelId),/至少需要保留一个文字频道/);

  assert.deepEqual(database.removeSpaceMember(owner.user,space.id,guest.user.id),{spaceId:space.id,userId:guest.user.id});
  assert.throws(()=>database.spaceMembers(guest.user.id,space.id),/无法访问/);
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
