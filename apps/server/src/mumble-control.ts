import { createRequire } from 'node:module';
import { Ice } from 'ice';
import { config } from './config.js';

const require=createRequire(import.meta.url);
const { MumbleServer }=require('./generated/MumbleServer.cjs') as typeof import('./generated/MumbleServer.cjs');
let communicator:Ice.Communicator|undefined;
let server:any;
const pending=new Map<string,Promise<string>>();
const context=new Map<string,string>([['secret',config.mumbleIceSecret]]);

async function getServer() {
  if(server)return server;
  communicator=Ice.initialize();
  const base=communicator.stringToProxy(`Meta:${config.mumbleIceEndpoint}`);
  const meta=await MumbleServer.MetaPrx.checkedCast(base);
  if(!meta)throw new Error('无法连接 Mumble Server ICE 控制接口');
  server=await meta.getServer(1,context);
  if(!server)throw new Error('Mumble Server 实例未启动');
  return server;
}

export function mumbleChannelName(channelId:string){return `ed-${channelId}`;}

export async function claimMumbleUsername(username:string) {
  try {
    const instance=await getServer();
    const users=await instance.getUsers(context) as Map<number,{name:string}>;
    for(const [session,user] of users) {
      if(user.name===username)await instance.kickUser(session,'连接已由新的 POIO 会话接管',context);
    }
  } catch(error) {
    server=undefined;
    if(communicator){await communicator.destroy().catch(()=>{});communicator=undefined;}
    throw error;
  }
}

export function ensureVoiceChannel(channelId:string) {
  const existing=pending.get(channelId);if(existing)return existing;
  const operation=(async()=>{
    try {
      const name=mumbleChannelName(channelId);const instance=await getServer();
      const channels=await instance.getChannels(context) as Map<number,{name:string}>;
      for(const channel of channels.values())if(channel.name===name)return name;
      await instance.addChannel(name,0,context);return name;
    } catch(error) {
      server=undefined;
      if(communicator){await communicator.destroy().catch(()=>{});communicator=undefined;}
      throw error;
    } finally {pending.delete(channelId);}
  })();
  pending.set(channelId,operation);return operation;
}

export async function closeMumbleControl(){server=undefined;if(communicator){await communicator.destroy();communicator=undefined;}}
