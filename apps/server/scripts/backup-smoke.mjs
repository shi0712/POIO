import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root=mkdtempSync(path.join(tmpdir(),'poio-backup-smoke-'));
process.env.DATABASE_PATH=path.join(root,'live.db');
process.env.BACKUP_PATH=path.join(root,'backups');

try{
  const module=await import('../dist/database.js');
  module.db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run('backup-smoke','backup-smoke','unused',Date.now());
  const backup=await module.runDatabaseBackup(true);
  if(!backup)throw new Error('backup was not created');
  const copy=new Database(backup,{readonly:true});
  const row=copy.prepare('SELECT username FROM users WHERE id=?').get('backup-smoke');
  copy.close();
  if(row?.username!=='backup-smoke')throw new Error('backup content is incomplete');
  const header=readFileSync(backup).subarray(0,16).toString('ascii');
  if(header!=='SQLite format 3\u0000')throw new Error('backup is not a valid SQLite database');
  console.log(JSON.stringify({ok:true,file:path.basename(backup),username:row.username}));
  module.db.close();
}finally{
  rmSync(root,{recursive:true,force:true});
}
