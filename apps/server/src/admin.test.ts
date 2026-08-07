import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath=path.join(os.tmpdir(),`poio-admin-test-${process.pid}.db`);
process.env.DATABASE_PATH=databasePath;
process.env.BACKUP_PATH=path.join(os.tmpdir(),`poio-admin-backups-${process.pid}`);
process.env.UPLOAD_PATH=path.join(os.tmpdir(),`poio-admin-uploads-${process.pid}`);
const database=await import('./database.js');
const games=await import('./games.js');
const adminApi=await import('./admin.js');

test('admin wallet management is allowlisted, transactional and audited',async()=>{
  const admin=(await database.register('sjw','Admin-test-password')).user;
  const target=(await database.register(`points_${Date.now()}`,'Target-test-password')).user;
  assert.equal(adminApi.isGameAdmin(admin,['sjw']),true);
  assert.equal(adminApi.isGameAdmin(target,['sjw']),false);
  assert.equal(games.gameWallet(target.id).balance,10_000);

  const added=adminApi.adjustGameWallet(admin,target.id,'add',10_000,'后台测试奖励');
  assert.equal(added.before,10_000);
  assert.equal(added.after,20_000);
  assert.equal(games.gameWallet(target.id).balance,20_000);

  const set=adminApi.adjustGameWallet(admin,target.id,'set',750,'修正测试余额');
  assert.equal(set.amount,-19_250);
  assert.equal(games.gameWallet(target.id).balance,750);
  assert.throws(()=>adminApi.adjustGameWallet(admin,target.id,'add',-751,'不能成为负数'),/不能小于 0/);

  const result=adminApi.listGameWallets(target.username,10,0);
  assert.equal(result.total,1);
  assert.equal((result.users[0] as any).balance,750);
  const audit=adminApi.gameAdminAudit(10) as Array<any>;
  assert.equal(audit.length,2);
  assert.equal(audit[0].adminUsername,'sjw');
  assert.equal(audit[0].targetUsername,target.username);
  assert.equal(audit[0].reason,'修正测试余额');
  const ledger=games.gameLedger(target.id,10);
  assert.equal(ledger[0].kind,'admin_set');
});

test.after(()=>{
  database.db.close();
  for(const suffix of ['','-shm','-wal'])rmSync(`${databasePath}${suffix}`,{force:true});
  rmSync(process.env.BACKUP_PATH!,{recursive:true,force:true});
  rmSync(process.env.UPLOAD_PATH!,{recursive:true,force:true});
});
