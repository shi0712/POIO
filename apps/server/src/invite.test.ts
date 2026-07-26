import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath=path.join(os.tmpdir(),`poio-invite-test-${process.pid}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.BACKUP_PATH=path.join(os.tmpdir(),`poio-invite-backups-${process.pid}`);
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

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
});
