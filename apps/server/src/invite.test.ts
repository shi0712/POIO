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

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
