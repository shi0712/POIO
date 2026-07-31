import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const pipeSuffix=String(process.pid);const pipe=String.raw`\\.\pipe\EchoDeckMumble-${pipeSuffix}`;
const connectSocket=async()=>{const socket=io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});const request=(event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,reply=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});return{socket,request}};
const command=(value,timeout=2500)=>new Promise((resolve,reject)=>{const client=net.createConnection(pipe);let response='';const timer=setTimeout(()=>{client.destroy();reject(new Error(`${value} timeout`))},timeout);client.setEncoding('utf8');client.once('connect',()=>client.write(`${value}\n`));client.on('data',chunk=>{response+=chunk;if(response.includes('\n')){clearTimeout(timer);client.destroy();resolve(response.trim())}});client.once('error',error=>{clearTimeout(timer);reject(error)})});
const startMumble=(executable,config,credentials,suffix)=>{writeFileSync(config,'{"settings_version":1}\n',{encoding:'utf8',flag:'wx'});const auth=`${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}`;const url=`mumble://${auth}@${credentials.host}:${credentials.port}/${encodeURIComponent(credentials.channelName)}?version=1.5.0`;const env=suffix?{...process.env,POIO_MUMBLE_PIPE_SUFFIX:suffix}:process.env;return spawn(executable,['--config',config,'--hidden','--multiple','--no-window-states','--skip-settings-backup-prompt',url],{cwd:path.dirname(executable),windowsHide:true,stdio:'ignore',env})};
const stopMumble=child=>new Promise(resolve=>{if(!child||child.exitCode!==null){resolve();return}const timeout=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timeout);resolve()});child.kill()});
const cleanupConfig=config=>{rmSync(config,{force:true});rmSync(`${config}.bak`,{force:true});rmSync(config.replace(/\.json$/,'.sqlite'),{force:true})};

const first=await connectSocket();const second=await connectSocket();let firstChild;let secondChild;
const firstConfig=path.join(os.tmpdir(),`poio-volume-first-${process.pid}.json`);const secondConfig=path.join(os.tmpdir(),`poio-volume-second-${process.pid}.json`);
const secondRuntime=path.join(os.tmpdir(),`poio-volume-runtime-${process.pid}`);
try{
  const suffix=Date.now().toString(36);const firstAuth=await first.request('auth:register',{username:`volume_a_${suffix}`,password:`Test-${suffix}-secure`});
  const voice=firstAuth.bootstrap[0].channels.find(channel=>channel.kind==='voice');if(!voice)throw new Error('first account has no voice channel');
  const invite=await first.request('space:invite',{spaceId:firstAuth.bootstrap[0].id});
  await second.request('auth:register',{username:`volume_b_${suffix}`,password:`Test-${suffix}-secure`});await second.request('space:join',{code:invite.code});
  const firstCredentials=await first.request('voice:credentials',{channelId:voice.id});const secondCredentials=await second.request('voice:credentials',{channelId:voice.id});
  const executable=path.resolve(process.env.ECHODECK_MUMBLE_EXE??'apps/desktop/resources/mumble/mumble.exe');
  firstChild=startMumble(executable,firstConfig,firstCredentials,pipeSuffix);
  const firstDeadline=Date.now()+25000;let status='';while(Date.now()<firstDeadline){if(firstChild.exitCode!==null)throw new Error(`first Mumble exited ${firstChild.exitCode}`);try{status=await command('STATUS');if(status.includes('connected=1'))break}catch{}await new Promise(resolve=>setTimeout(resolve,300))}if(!status.includes('connected=1'))throw new Error(`first Mumble did not connect: ${status}`);
  cpSync(path.dirname(executable),secondRuntime,{recursive:true});rmSync(path.join(secondRuntime,'plugins','echodeckBridge.dll'),{force:true});
  secondChild=startMumble(path.join(secondRuntime,path.basename(executable)),secondConfig,secondCredentials);
  const usersDeadline=Date.now()+25000;let users=[];while(Date.now()<usersDeadline){if(secondChild.exitCode!==null)throw new Error(`second Mumble exited ${secondChild.exitCode}`);try{const reply=await command('USERS');if(reply.startsWith('OK ')){users=JSON.parse(reply.slice(3));if(users.some(user=>user.username===secondCredentials.username))break}}catch{}await new Promise(resolve=>setTimeout(resolve,350))}
  const remote=users.find(user=>user.username===secondCredentials.username);if(!remote)throw new Error(`remote native user missing: ${JSON.stringify(users)}`);if(typeof remote.talking!=='boolean')throw new Error(`remote talking state missing: ${JSON.stringify(remote)}`);
  const changed=await command(`SET_USER_VOLUME ${secondCredentials.username} 37`);if(changed!=='OK')throw new Error(`set user volume failed: ${changed}`);
  const verifiedReply=await command('USERS');const verified=JSON.parse(verifiedReply.slice(3)).find(user=>user.username===secondCredentials.username);if(verified?.volume!==37)throw new Error(`volume was not applied: ${verifiedReply}`);
  await command(`SET_USER_VOLUME ${secondCredentials.username} 100`);
  console.log(JSON.stringify({nativePerUserVolume:true,nativeTalkingState:true,remoteUser:secondCredentials.username,talking:remote.talking,initialVolume:remote.volume,adjustedVolume:verified.volume}));
}finally{await Promise.all([stopMumble(firstChild),stopMumble(secondChild)]);first.socket.close();second.socket.close();cleanupConfig(firstConfig);cleanupConfig(secondConfig);try{rmSync(secondRuntime,{recursive:true,force:true,maxRetries:5,retryDelay:300})}catch{}}
