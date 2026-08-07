import 'dotenv/config';

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const list = (name:string,fallback:string) =>
  (process.env[name]?.trim()||fallback).split(',').map(value=>value.trim()).filter(Boolean);

const publicIp = process.env.PUBLIC_IP ?? '127.0.0.1';
const p2pIceServers:Array<{urls:string[];username?:string;credential?:string}> = [
  {urls:list('P2P_STUN_URLS',`stun:${publicIp}:3478,stun:stun.cloudflare.com:3478`)}
];
const turnUrls=list('P2P_TURN_URLS','');
if(turnUrls.length&&process.env.P2P_TURN_USERNAME&&process.env.P2P_TURN_PASSWORD)p2pIceServers.push({
  urls:turnUrls,
  username:process.env.P2P_TURN_USERNAME,
  credential:process.env.P2P_TURN_PASSWORD
});

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: number('PORT', 17920),
  databasePath: process.env.DATABASE_PATH ?? './data/echodeck.db',
  backupPath: process.env.BACKUP_PATH ?? './data/backups',
  backupIntervalHours: number('BACKUP_INTERVAL_HOURS', 24),
  backupRetentionDays: number('BACKUP_RETENTION_DAYS', 14),
  uploadPath: process.env.UPLOAD_PATH ?? './data/uploads',
  downloadPath: process.env.DOWNLOAD_PATH ?? './deploy/download',
  releasePath: process.env.RELEASE_PATH ?? './releases',
  publicIp,
  publicAppUrl: process.env.PUBLIC_APP_URL ?? `https://${process.env.PUBLIC_IP ?? '127.0.0.1'}/poio`,
  mumbleHost: process.env.MUMBLE_PUBLIC_HOST ?? process.env.PUBLIC_IP ?? '127.0.0.1',
  mumblePort: number('MUMBLE_PORT', 64738),
  mumblePassword: process.env.MUMBLE_SERVER_PASSWORD ?? 'echodeck-local-development',
  mumbleIceEndpoint: process.env.MUMBLE_ICE_ENDPOINT ?? 'tcp -h 127.0.0.1 -p 6502',
  mumbleIceSecret: process.env.MUMBLE_ICE_SECRET ?? 'echodeck-local-ice-secret',
  mediaPort: number('MEDIASOUP_PORT', 17921),
  mediaMinPort: number('MEDIASOUP_MIN_PORT', 41000),
  mediaMaxPort: number('MEDIASOUP_MAX_PORT', 41999),
  p2pIceServers,
  adminUsernames: list('ADMIN_USERNAMES','sjw').map(value=>value.toLocaleLowerCase('en-US')),
  sessionDays: number('SESSION_DAYS', 30),
  corsOrigin: process.env.CORS_ORIGIN ?? '*'
};
