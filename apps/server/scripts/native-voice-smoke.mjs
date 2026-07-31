import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const origin=process.env.ECHODECK_SMOKE_URL??'https://115.159.222.29';
const socket=io(origin,{path:'/poio/socket.io',transports:['websocket'],reconnection:false});
const request=(event,payload={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),15000);socket.emit(event,payload,(reply)=>{clearTimeout(timer);reply?.ok?resolve(reply.value):reject(new Error(reply?.error??`${event} failed`))})});
const pipeSuffix=`smoke-${process.pid}`;
const pipe=`${String.raw`\\.\pipe\EchoDeckMumble`}-${pipeSuffix}`;
const command=(value,timeout=1500)=>new Promise((resolve,reject)=>{const client=net.createConnection(pipe);let text='';const timer=setTimeout(()=>{client.destroy();reject(new Error('pipe timeout'))},timeout);client.setEncoding('utf8');client.once('connect',()=>client.write(`${value}\n`));client.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);client.destroy();resolve(text.trim())}});client.once('error',error=>{clearTimeout(timer);reject(error)})});
await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
let child;
const configFile=path.join(os.tmpdir(),`echodeck-mumble-smoke-${process.pid}.json`);
writeFileSync(configFile,'{"settings_version":1}\n',{encoding:'utf8',flag:'wx'});
try {
  const suffix=Date.now().toString(36);const auth=await request('auth:register',{username:`native_${suffix}`,password:`Test-${suffix}-secure`});
  const voices=auth.bootstrap[0].channels.filter(channel=>channel.kind==='voice');const first=await request('voice:credentials',{channelId:voices[0].id});
  const created=await request('channel:create',{spaceId:auth.bootstrap[0].id,name:'原生切换测试',kind:'voice'});
  const executable=path.resolve(process.env.ECHODECK_MUMBLE_EXE??'apps/desktop/release/win-unpacked/resources/mumble/mumble.exe');
  const authPart=`${encodeURIComponent(first.username)}:${encodeURIComponent(first.password)}`;const url=`mumble://${authPart}@${first.host}:${first.port}/${encodeURIComponent(first.channelName)}?version=1.5.0`;
  child=spawn(executable,['--config',configFile,'--hidden','--multiple','--no-window-states','--skip-settings-backup-prompt',url],{cwd:path.dirname(executable),windowsHide:true,stdio:'ignore',env:{...process.env,POIO_MUMBLE_PIPE_SUFFIX:pipeSuffix}});
  const deadline=Date.now()+25000;let status='';
  while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`Mumble exited ${child.exitCode}`);try{status=await command('STATUS');if(status.includes('connected=1'))break}catch{}await new Promise(resolve=>setTimeout(resolve,350))}
  if(!status.includes('connected=1'))throw new Error(`native Mumble did not connect: ${status}`);
  await request('voice:join',{channelId:voices[0].id});
  const credentialStarted=Date.now();const second=await request('voice:credentials',{channelId:created.id});const credentialMs=Date.now()-credentialStarted;
  if(child.exitCode!==null)throw new Error(`Mumble was kicked while requesting switch credentials: ${child.exitCode}`);
  console.log('stage=status',status);const deviceReply=await command('DEVICES',5000);console.log('stage=devices',deviceReply);if(!deviceReply.startsWith('OK '))throw new Error(`device enumeration failed: ${deviceReply}`);const devices=JSON.parse(deviceReply.slice(3));
  const selectedInput=devices.inputs[1]??devices.inputs.find(device=>device.selected)??devices.inputs[0];const selectedOutput=devices.outputs[1]??devices.outputs.find(device=>device.selected)??devices.outputs[0];
  if(!selectedInput||!selectedOutput)throw new Error(`no audio devices: ${deviceReply}`);
  const setInput=await command(`SET_INPUT ${selectedInput.index}`,10000);console.log('stage=set-input',setInput);await command('DEVICES',10000);const setOutput=await command(`SET_OUTPUT ${selectedOutput.index}`,10000);console.log('stage=set-output',setOutput);await command('DEVICES',10000);
  const configure=await command('CONFIGURE');const levelSamples=[];for(let index=0;index<20;index++){levelSamples.push(Number((await command('LEVEL')).slice(3)));await new Promise(resolve=>setTimeout(resolve,80))}const level=`OK ${levelSamples.at(-1)}`;const volumes=await command('VOLUMES');const setInputVolume=await command('SET_VOLUME input 82');const setOutputVolume=await command('SET_VOLUME output 91');const updatedVolumes=await command('VOLUMES');
  const mute=await command('MUTE 1');const unmute=await command('MUTE 0');let move='';const moveStarted=Date.now();const moveDeadline=moveStarted+8000;do{move=await command(`MOVE ${second.channelName}`);if(move.startsWith('OK'))break;await new Promise(resolve=>setTimeout(resolve,400))}while(Date.now()<moveDeadline);const moveMs=Date.now()-moveStarted;
  await request('voice:join',{channelId:created.id});
  if(!configure.startsWith('OK')||!setInput.startsWith('OK')||!setOutput.startsWith('OK')||levelSamples.some(value=>!Number.isFinite(value)||value<0||value>1000)||!volumes.startsWith('OK input=')||!setInputVolume.startsWith('OK')||!setOutputVolume.startsWith('OK')||updatedVolumes!=='OK input=82 output=91'||!mute.startsWith('OK')||!unmute.startsWith('OK')||!move.startsWith('OK'))throw new Error(`native control failed: ${configure};${setInput};${setOutput};${level};${volumes};${setInputVolume};${setOutputVolume};${updatedVolumes};${mute};${unmute};${move}`);
  console.log(JSON.stringify({nativeMumble:true,connected:true,port:first.port,firstChannel:first.channelName,secondChannel:second.channelName,credentialMs,moveMs,inputDevices:devices.inputs.length,outputDevices:devices.outputs.length,configure,levelMin:Math.min(...levelSamples),levelMax:Math.max(...levelSamples),volumes,updatedVolumes,setInput,setOutput,mute,unmute,move}));
} finally {child?.kill();socket.close();rmSync(configFile,{force:true});rmSync(`${configFile}.bak`,{force:true});rmSync(configFile.replace(/\.json$/,'.sqlite'),{force:true});}
