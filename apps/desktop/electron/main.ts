import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, screen, session, shell, Tray } from 'electron';
import electronUpdater from 'electron-updater';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeShareSidecar } from './native-share.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = electronUpdater;
const appIcon = app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'build', 'icon.png') : path.join(dirname, '../build/icon.png');
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let mumbleProcess: ChildProcess | null = null;
let mumbleIdentity = '';
let mumbleLastFailure = '';
let desiredMumbleConnection: MumbleConnection | undefined;
let mumbleRestartTimer: NodeJS.Timeout | undefined;
let mumbleRestartAttempts = 0;
let appQuitting = false;
let mumbleMuted = false;
let mumbleDeafened = false;
let mumbleTransmitting = false;
let mumblePushToTalkActive = false;
let pendingInviteCode: string | undefined;
const repositoryRoot = path.resolve(dirname, '../../..');
const nativeShare = new NativeShareSidecar(
  repositoryRoot,
  message => sendToMainWindow('native-share:message', message),
);
const mumblePipeSuffix = process.pid.toString(36);
const mumblePipe = `${String.raw`\\.\pipe\EchoDeckMumble`}-${mumblePipeSuffix}`;

type MumbleConnection = { host:string;port:number;username:string;password:string;channelName:string };
type MumbleRuntimeState = { state:'disconnected'|'connecting'|'connected'|'reconnecting'|'error';attempt?:number;message?:string };
type MumbleAudioDevice = { index:number;name:string;selected:boolean };
type MumbleAudioDevices = { inputBackend?:string;outputBackend?:string;inputs:MumbleAudioDevice[];outputs:MumbleAudioDevice[] };
type MumbleUserVolume = { username:string;volume:number;talking:boolean };
type AppUpdateStatus = { state:'idle'|'checking'|'available'|'downloading'|'downloaded'|'up-to-date'|'error'|'development';version?:string;percent?:number;message?:string;notes?:string };
type VoiceShortcut = { virtualKey:number;modifiers:number;label:string };
type DesktopPreferences = { closeToTray:boolean;launchAtLogin:boolean;muteShortcut:VoiceShortcut;pushToTalkEnabled:boolean;pushToTalkShortcut:VoiceShortcut };
type StoredDesktopPreferences = { closeToTray:boolean;trayHintShown:boolean;muteShortcut:VoiceShortcut;pushToTalkEnabled:boolean;pushToTalkShortcut:VoiceShortcut };
const defaultMuteShortcut:VoiceShortcut={virtualKey:77,modifiers:3,label:'Ctrl + Shift + M'};
const defaultPushToTalkShortcut:VoiceShortcut={virtualKey:86,modifiers:0,label:'V'};
let appUpdateStatus:AppUpdateStatus={state:'idle'};
let mumbleRuntimeState:MumbleRuntimeState={state:'disconnected'};
let lastAppUpdateCheck=0;
let desktopPreferences:StoredDesktopPreferences={closeToTray:true,trayHintShown:false,muteShortcut:defaultMuteShortcut,pushToTalkEnabled:false,pushToTalkShortcut:defaultPushToTalkShortcut};

function sendToMainWindow(channel:string,value:unknown) {
  const window=mainWindow;
  if(!window||window.isDestroyed()||window.webContents.isDestroyed())return;
  window.webContents.send(channel,value);
}

function inviteCodeFromUrl(value:string) {
  try{
    const url=new URL(value);
    if(url.protocol!=='poio:'||url.hostname.toLowerCase()!=='invite')return undefined;
    const code=decodeURIComponent(url.pathname.split('/').filter(Boolean)[0]??'').toUpperCase();
    return /^[A-F0-9]{10}$/.test(code)?code:undefined;
  }catch{return undefined}
}

function inviteCodeFromArguments(values:string[]) {
  for(const value of values){
    const code=inviteCodeFromUrl(value);
    if(code)return code;
  }
  return undefined;
}

function queueInviteCode(code:string|undefined) {
  if(!code)return;
  pendingInviteCode=code;
  showMainWindow();
  sendToMainWindow('invite:received',undefined);
}

function sidecarDirectory() {
  return app.isPackaged ? path.join(process.resourcesPath, 'mumble') : path.join(dirname, '../resources/mumble');
}

function publishMumbleState(state:MumbleRuntimeState) {
  mumbleRuntimeState=state;
  sendToMainWindow('mumble:state',state);
  updateTrayMenu();
  return state;
}

function publishMumbleControls() {
  sendToMainWindow('mumble:controls',{
    muted:mumbleMuted,
    deafened:mumbleDeafened,
    transmitting:mumbleTransmitting,
    pushToTalkActive:mumblePushToTalkActive,
  });
  updateTrayMenu();
}

function connectionIdentity(connection:MumbleConnection) {
  return `${connection.username}@${connection.host}:${connection.port}`;
}

function sameMumbleConnection(left:MumbleConnection|undefined,right:MumbleConnection|undefined) {
  return Boolean(left&&right&&connectionIdentity(left)===connectionIdentity(right)&&left.channelName===right.channelName);
}

function stopMumble(clearDesired=true) {
  const child=mumbleProcess;
  mumbleProcess = null;
  mumbleIdentity = '';
  mumbleTransmitting=false;
  mumblePushToTalkActive=false;
  publishMumbleControls();
  if(clearDesired){
    desiredMumbleConnection=undefined;
    mumbleRestartAttempts=0;
    if(mumbleRestartTimer)clearTimeout(mumbleRestartTimer);
    mumbleRestartTimer=undefined;
    mumbleLastFailure=child?'连接已被客户端取消':mumbleLastFailure;
    publishMumbleState({state:'disconnected'});
  }
  if (child && !child.killed) child.kill();
}

function scheduleMumbleRestart() {
  const connection=desiredMumbleConnection;
  if(appQuitting||!connection||mumbleRestartTimer)return;
  const attempt=++mumbleRestartAttempts;
  const delay=Math.min(15_000,750*2**Math.min(attempt-1,5));
  publishMumbleState({state:'reconnecting',attempt,message:`语音核心已退出，${Math.ceil(delay/1000)} 秒后自动恢复`});
  mumbleRestartTimer=setTimeout(()=>{
    mumbleRestartTimer=undefined;
    const desired=desiredMumbleConnection;
    if(appQuitting||!desired||!sameMumbleConnection(desired,connection))return;
    void connectMumble({...desired},true).catch(error=>{
      mumbleLastFailure=error instanceof Error?error.message:String(error);
      publishMumbleState({state:'error',attempt:mumbleRestartAttempts,message:mumbleLastFailure});
      scheduleMumbleRestart();
    });
  },delay);
  mumbleRestartTimer.unref();
}

function exitCodeDescription(code:number|null,signal:NodeJS.Signals|null) {
  if(code!==null)return `${code} / 0x${(code>>>0).toString(16).toUpperCase().padStart(8,'0')}`;
  return signal?`信号 ${signal}`:'未提供退出码';
}

function mumbleCommandOnce(command:string, timeoutMs=2500) {
  return new Promise<string>((resolve,reject) => {
    const socket=net.createConnection(mumblePipe); let buffer=''; let settled=false;
    const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value??'');};
    const timer=setTimeout(()=>finish(new Error('Mumble 原生音频核心响应超时')),timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect',()=>socket.write(`${command}\n`));
    socket.on('data',(chunk:string)=>{buffer+=chunk;const newline=buffer.indexOf('\n');if(newline>=0)finish(undefined,buffer.slice(0,newline).trim())});
    socket.once('error',(error)=>finish(error));
    socket.once('close',()=>{if(!settled&&buffer.trim())finish(undefined,buffer.trim())});
  });
}

let mumbleCommandQueue:Promise<unknown>=Promise.resolve();
function mumbleCommand(command:string,timeoutMs=2500) {
  const run=async()=>{
    let lastError:unknown;
    for(let attempt=0;attempt<8;attempt++){
      try{return await mumbleCommandOnce(command,timeoutMs)}catch(error){
        lastError=error;
        const code=(error as NodeJS.ErrnoException)?.code;
        if(code!=='ENOENT'&&code!=='EBUSY'&&code!=='ECONNREFUSED')throw error;
        await new Promise(resolve=>setTimeout(resolve,35+attempt*15));
      }
    }
    throw lastError;
  };
  const result=mumbleCommandQueue.then(run,run);
  mumbleCommandQueue=result.then(()=>undefined,()=>undefined);
  return result;
}

async function waitForMumbleBridge(child:ChildProcess) {
  const deadline=Date.now()+15_000; let lastError:unknown;
  while(Date.now()<deadline){
    if(mumbleProcess!==child)throw new Error(`Mumble 原生音频核心启动失败：${mumbleLastFailure||'连接已被替换'}`);
    if(child.exitCode!==null)throw new Error(`Mumble 原生音频核心启动失败：${mumbleLastFailure||`进程退出 ${exitCodeDescription(child.exitCode,child.signalCode)}`}`);
    try { if(await mumbleCommand('PING',700)==='OK PONG') return; } catch(error){lastError=error;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw lastError instanceof Error?lastError:new Error('无法连接 Mumble 原生音频核心');
}

async function activateMumbleAudio() {
  const mute=desktopPreferences.muteShortcut;
  const pushToTalk=desktopPreferences.pushToTalkShortcut;
  const hotkeys=`HOTKEYS ${mute.virtualKey} ${mute.modifiers} ${pushToTalk.virtualKey} ${pushToTalk.modifiers} ${desktopPreferences.pushToTalkEnabled?1:0}`;
  for(const command of ['CONFIGURE',hotkeys,`DEAF ${mumbleDeafened?1:0}`,`MUTE ${mumbleMuted?1:0}`]){
    const result=await mumbleCommand(command);
    if(!result.startsWith('OK'))throw new Error(`恢复 Mumble 音频失败：${result}`);
  }
  return mumbleCommand('STATUS');
}

async function connectMumble(connection:MumbleConnection,recovering=false) {
  if(!/^[a-zA-Z0-9.-]{1,253}$/.test(connection.host)||!Number.isInteger(connection.port)||connection.port<1||connection.port>65535) throw new Error('Mumble 服务器地址无效');
  if(!connection.username||connection.username.length>64||!connection.channelName||connection.channelName.length>128) throw new Error('Mumble 连接参数无效');
  const identity=connectionIdentity(connection);
  const activeProcess=mumbleProcess;
  const sameActiveConnection=!recovering
    &&mumbleRuntimeState.state==='connected'
    &&activeProcess
    &&activeProcess.exitCode===null
    &&sameMumbleConnection(desiredMumbleConnection,connection);
  if(sameActiveConnection){
    try{
      await waitForMumbleBridge(activeProcess);
      const status=await mumbleCommand('STATUS');
      if(/connected=1/.test(status))return status;
    }catch{
      // The process looked connected but stopped responding. Fall through to
      // the normal replacement path instead of surfacing a duplicate error.
    }
  }
  if(!recovering){
    desiredMumbleConnection={...connection};
    mumbleRestartAttempts=0;
    mumbleMuted=false;
    mumbleDeafened=false;
    if(mumbleRestartTimer)clearTimeout(mumbleRestartTimer);
    mumbleRestartTimer=undefined;
    publishMumbleState({state:'connecting'});
  }else if(!sameMumbleConnection(desiredMumbleConnection,connection)){
    throw new Error('语音连接已被取消');
  }else{
    publishMumbleState({state:'reconnecting',attempt:mumbleRestartAttempts,message:'正在重新启动 Mumble 原生语音核心'});
  }
  if(mumbleProcess&&mumbleProcess.exitCode===null&&mumbleIdentity===identity){
    const child=mumbleProcess;
    let moveResult='';
    try{
      await waitForMumbleBridge(child);
      const deadline=Date.now()+6_000;
      do {
        moveResult=await mumbleCommand(`MOVE ${connection.channelName}`);
        if(moveResult.startsWith('OK')){
          const status=await activateMumbleAudio();
          mumbleRestartAttempts=0;
          publishMumbleState({state:'connected'});
          return status;
        }
        await new Promise(resolve=>setTimeout(resolve,300));
      } while(moveResult.includes('channel-not-found')&&Date.now()<deadline);
    }catch(error){
      moveResult=error instanceof Error?error.message:String(error);
    }
    // Moving inside the existing Mumble process is the fast path. If the
    // channel has not propagated yet or the bridge is restarting, replace the
    // process and connect directly to the requested channel instead of making
    // the user hang up and click the channel again.
    mumbleLastFailure=`Mumble 原地切换失败，正在重新连接：${moveResult||'未知错误'}`;
    stopMumble(false);
    publishMumbleState({state:'connecting',message:'正在切换语音频道'});
  }
  stopMumble(false);
  const directory=sidecarDirectory(); const executable=path.join(directory,'mumble.exe');
  if(!existsSync(executable))throw new Error('安装包缺少 Mumble 原生音频核心');
  const configDirectory=path.join(app.getPath('userData'),'mumble-native');
  mkdirSync(configDirectory,{recursive:true});
  const configFile=path.join(configDirectory,'echodeck-mumble.json');
  let validConfig=false;
  if(existsSync(configFile))try{validConfig=JSON.parse(readFileSync(configFile,'utf8'))?.settings_version===1}catch{}
  if(!validConfig)writeFileSync(configFile,'{"settings_version":1}\n',{encoding:'utf8'});
  const auth=`${encodeURIComponent(connection.username)}:${encodeURIComponent(connection.password)}`;
  const url=`mumble://${auth}@${connection.host}:${connection.port}/${encodeURIComponent(connection.channelName)}?version=1.5.0`;
  mumbleLastFailure='';
  const child=spawn(executable,['--config',configFile,'--hidden','--multiple','--no-window-states','--skip-settings-backup-prompt',url],{cwd:directory,windowsHide:true,stdio:'ignore',env:{...process.env,POIO_MUMBLE_PIPE_SUFFIX:mumblePipeSuffix}});
  mumbleProcess=child;
  mumbleIdentity=identity;
  child.once('error',(error)=>{mumbleLastFailure=`无法创建进程（${error.message}）`});
  child.once('exit',(code,signal)=>{
    if(mumbleProcess===child){
      mumbleLastFailure=`进程退出 ${exitCodeDescription(code,signal)}。若错误码为 0xC0000135，请检查安全软件是否隔离了安装目录中的 DLL`;
      mumbleProcess=null;mumbleIdentity='';
      mumbleTransmitting=false;
      mumblePushToTalkActive=false;
      publishMumbleControls();
      scheduleMumbleRestart();
    }
  });
  try{
    await waitForMumbleBridge(child);
    const deadline=Date.now()+15_000;
    while(Date.now()<deadline){const status=await mumbleCommand('STATUS');if(/connected=1/.test(status)){const active=await activateMumbleAudio();mumbleRestartAttempts=0;publishMumbleState({state:'connected'});return active}await new Promise(resolve=>setTimeout(resolve,300));}
    throw new Error('Mumble 服务器连接超时');
  }catch(error){
    if(mumbleProcess===child)stopMumble(false);
    if(recovering)scheduleMumbleRestart();
    else if(sameMumbleConnection(desiredMumbleConnection,connection))publishMumbleState({state:'error',message:error instanceof Error?error.message:String(error)});
    throw error;
  }
}

async function getMumbleAudioDevices():Promise<MumbleAudioDevices> {
  if(!mumbleProcess||mumbleProcess.exitCode!==null)throw new Error('请先加入一个语音频道，再选择输入和输出设备');
  const result=await mumbleCommand('DEVICES',5000);
  if(!result.startsWith('OK '))throw new Error(`读取音频设备失败：${result}`);
  const devices=JSON.parse(result.slice(3)) as MumbleAudioDevices;
  if(!Array.isArray(devices.inputs)||!Array.isArray(devices.outputs))throw new Error('Mumble 返回了无效的设备列表');
  return devices;
}

async function getMumbleInputLevel() {
  if(!mumbleProcess||mumbleProcess.exitCode!==null)return 0;
  const result=await mumbleCommand('LEVEL',1000);
  const match=/^OK (\d+)$/.exec(result);
  if(!match)throw new Error(`读取麦克风音量失败：${result}`);
  return Math.min(1,Math.max(0,Number(match[1])/1000));
}

async function getMumbleVolumes() {
  if(!mumbleProcess||mumbleProcess.exitCode!==null)throw new Error('请先加入语音频道');
  const result=await mumbleCommand('VOLUMES',1500);
  const match=/^OK input=(\d+) output=(\d+)$/.exec(result);
  if(!match)throw new Error(`读取音量失败：${result}`);
  return {input:Number(match[1]),output:Number(match[2])};
}

async function setMumbleVolume(kind:'input'|'output',value:number) {
  const maximum=kind==='input'?100:200;
  if(!Number.isInteger(value)||value<0||value>maximum)throw new Error('无效的音量值');
  const result=await mumbleCommand(`SET_VOLUME ${kind} ${value}`,2500);
  if(!result.startsWith('OK'))throw new Error(`设置音量失败：${result}`);
  return getMumbleVolumes();
}

async function getMumbleUsers():Promise<MumbleUserVolume[]> {
  if(!mumbleProcess||mumbleProcess.exitCode!==null)return [];
  const result=await mumbleCommand('USERS',2500);
  if(!result.startsWith('OK '))throw new Error(`读取频道用户失败：${result}`);
  const users=JSON.parse(result.slice(3)) as MumbleUserVolume[];
  if(!Array.isArray(users)||users.some(item=>typeof item?.username!=='string'||!Number.isInteger(item?.volume)||(item?.talking!==undefined&&typeof item.talking!=='boolean')))throw new Error('Mumble 返回了无效的用户状态列表');
  return users.filter(item=>item.volume>=0&&item.volume<=200).map(item=>({...item,talking:item.talking===true}));
}

async function setMumbleUserVolume(username:string,value:number) {
  if(!/^ed_[a-zA-Z0-9_-]{1,80}$/.test(username))throw new Error('无效的频道用户');
  if(!Number.isInteger(value)||value<0||value>200)throw new Error('无效的用户音量值');
  if(!mumbleProcess||mumbleProcess.exitCode!==null)throw new Error('请先加入语音频道');
  let result='';
  for(let attempt=0;attempt<10;attempt++){
    result=await mumbleCommand(`SET_USER_VOLUME ${username} ${value}`,2500);
    if(result.startsWith('OK'))return value;
    if(!result.includes('user-volume--2'))break;
    await new Promise(resolve=>setTimeout(resolve,150+attempt*50));
  }
  throw new Error(`设置用户音量失败：${result}`);
}

async function setMumbleAudioDevice(kind:'input'|'output',index:number) {
  if(!Number.isInteger(index)||index<0)throw new Error('无效的音频设备');
  if(!mumbleProcess||mumbleProcess.exitCode!==null)throw new Error('请先加入一个语音频道');
  const result=await mumbleCommand(`${kind==='input'?'SET_INPUT':'SET_OUTPUT'} ${index}`,10_000);
  if(!result.startsWith('OK'))throw new Error(`切换音频设备失败：${result}`);
  return getMumbleAudioDevices();
}

async function buildDiagnostics() {
  const running=Boolean(mumbleProcess&&mumbleProcess.exitCode===null);
  let mumbleStatus=running?'响应失败':'未运行';
  let audioDevices='未连接语音频道';
  if(running){
    try{mumbleStatus=await mumbleCommand('STATUS',1800)}catch(error){mumbleStatus=error instanceof Error?error.message:String(error)}
    try{
      const devices=await getMumbleAudioDevices();
      const input=devices.inputs.find(device=>device.selected)?.name??'未选择';
      const output=devices.outputs.find(device=>device.selected)?.name??'未选择';
      audioDevices=`输入 ${devices.inputBackend??'未知'} / ${input}; 输出 ${devices.outputBackend??'未知'} / ${output}`;
    }catch(error){audioDevices=error instanceof Error?error.message:String(error)}
  }
  const update=`${appUpdateStatus.state}${appUpdateStatus.version?` ${appUpdateStatus.version}`:''}${appUpdateStatus.percent!==undefined?` ${appUpdateStatus.percent}%`:''}${appUpdateStatus.message?` / ${appUpdateStatus.message}`:''}`;
  return [
    'POIO 诊断信息',
    `生成时间: ${new Date().toISOString()}`,
    `应用版本: ${app.getVersion()} (${app.isPackaged?'安装版':'开发版'})`,
    `运行环境: Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    `系统: Windows ${os.release()} ${os.arch()} / ${Math.round(os.totalmem()/1024/1024/1024)} GB RAM`,
    `在线更新: ${update}`,
    `Mumble 原生核心: ${running?'运行中':'未运行'}${mumbleLastFailure?` / 最近状态 ${mumbleLastFailure}`:''}`,
    `Mumble PID: ${mumbleProcess?.pid??'无'}`,
    `Mumble 自动恢复: ${mumbleRuntimeState.state}${mumbleRuntimeState.attempt?` / 第 ${mumbleRuntimeState.attempt} 次`:''}${mumbleRuntimeState.message?` / ${mumbleRuntimeState.message}`:''}`,
    `Mumble 状态: ${mumbleStatus}`,
    `音频设备: ${audioDevices}`
  ].join('\n');
}

function publishUpdateStatus(status:AppUpdateStatus) {
  appUpdateStatus=status;
  sendToMainWindow('update:status',status);
  return status;
}

function releaseNotesText(value:unknown) {
  if(typeof value==='string')return value.trim()||undefined;
  if(Array.isArray(value)){
    const notes=value.map(item=>typeof item==='string'?item:typeof item==='object'&&item&&'note' in item?String(item.note):'').filter(Boolean);
    return notes.join('\n\n').trim()||undefined;
  }
  return undefined;
}

async function checkForAppUpdate() {
  lastAppUpdateCheck=Date.now();
  if(!app.isPackaged)return publishUpdateStatus({state:'development',message:'开发模式不检查更新'});
  publishUpdateStatus({state:'checking'});
  try{await autoUpdater.checkForUpdates();return appUpdateStatus}catch(error){return publishUpdateStatus({state:'error',message:error instanceof Error?error.message:'检查更新失败'})}
}

async function downloadAppUpdate() {
  if(!app.isPackaged)return publishUpdateStatus({state:'development',message:'开发模式不下载更新'});
  if(appUpdateStatus.state==='downloaded'||appUpdateStatus.state==='downloading')return appUpdateStatus;
  if(appUpdateStatus.state!=='available'){
    const checked=await checkForAppUpdate();
    if(checked.state!=='available')return checked;
  }
  const pending=appUpdateStatus;
  publishUpdateStatus({...pending,state:'downloading',percent:0});
  try{await autoUpdater.downloadUpdate();return appUpdateStatus}catch(error){return publishUpdateStatus({...pending,state:'error',message:error instanceof Error?error.message:'下载更新失败'})}
}

function initializeAutoUpdates() {
  if(!app.isPackaged){publishUpdateStatus({state:'development',message:'开发模式不检查更新'});return}
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=true;
  autoUpdater.allowPrerelease=false;
  autoUpdater.setFeedURL({provider:'generic',url:'https://115.159.222.29/poio/releases/'});
  autoUpdater.on('checking-for-update',()=>publishUpdateStatus({state:'checking'}));
  autoUpdater.on('update-available',info=>publishUpdateStatus({state:'available',version:info.version,notes:releaseNotesText(info.releaseNotes)}));
  autoUpdater.on('update-not-available',info=>publishUpdateStatus({state:'up-to-date',version:info.version}));
  autoUpdater.on('download-progress',progress=>publishUpdateStatus({...appUpdateStatus,state:'downloading',percent:Math.round(progress.percent)}));
  autoUpdater.on('update-downloaded',info=>publishUpdateStatus({state:'downloaded',version:info.version,percent:100,notes:releaseNotesText(info.releaseNotes)??appUpdateStatus.notes}));
  autoUpdater.on('error',error=>publishUpdateStatus({state:'error',message:error.message}));
  const maybeCheck=()=>{
    if(Date.now()-lastAppUpdateCheck<5*60_000||['checking','available','downloading','downloaded'].includes(appUpdateStatus.state))return;
    void checkForAppUpdate();
  };
  setTimeout(maybeCheck,5000);
  setInterval(maybeCheck,10*60_000);
  mainWindow?.on('focus',maybeCheck);
}

function desktopPreferencesPath() {
  return path.join(app.getPath('userData'),'desktop-preferences.json');
}

function saveDesktopPreferences() {
  writeFileSync(desktopPreferencesPath(),`${JSON.stringify(desktopPreferences,null,2)}\n`,{encoding:'utf8'});
}

function validShortcut(value:unknown,fallback:VoiceShortcut):VoiceShortcut {
  if(!value||typeof value!=='object')return fallback;
  const shortcut=value as Partial<VoiceShortcut>;
  if(!Number.isInteger(shortcut.virtualKey)||Number(shortcut.virtualKey)<1||Number(shortcut.virtualKey)>255
    ||!Number.isInteger(shortcut.modifiers)||Number(shortcut.modifiers)<0||Number(shortcut.modifiers)>15
    ||typeof shortcut.label!=='string'||shortcut.label.length<1||shortcut.label.length>64)return fallback;
  return {virtualKey:Number(shortcut.virtualKey),modifiers:Number(shortcut.modifiers),label:shortcut.label};
}

function loadDesktopPreferences() {
  const file=desktopPreferencesPath();
  if(!existsSync(file))return;
  try{
    const stored=JSON.parse(readFileSync(file,'utf8')) as Partial<StoredDesktopPreferences>;
    desktopPreferences={
      closeToTray:typeof stored.closeToTray==='boolean'?stored.closeToTray:true,
      trayHintShown:stored.trayHintShown===true,
      muteShortcut:validShortcut(stored.muteShortcut,defaultMuteShortcut),
      pushToTalkEnabled:stored.pushToTalkEnabled===true,
      pushToTalkShortcut:validShortcut(stored.pushToTalkShortcut,defaultPushToTalkShortcut),
    };
  }catch{}
}

function getDesktopPreferences():DesktopPreferences {
  return {
    closeToTray:desktopPreferences.closeToTray,
    launchAtLogin:app.isPackaged&&app.getLoginItemSettings().openAtLogin,
    muteShortcut:desktopPreferences.muteShortcut,
    pushToTalkEnabled:desktopPreferences.pushToTalkEnabled,
    pushToTalkShortcut:desktopPreferences.pushToTalkShortcut,
  };
}

async function setDesktopPreferences(patch:Partial<DesktopPreferences>) {
  if(typeof patch.closeToTray==='boolean')desktopPreferences.closeToTray=patch.closeToTray;
  if(patch.muteShortcut)desktopPreferences.muteShortcut=validShortcut(patch.muteShortcut,desktopPreferences.muteShortcut);
  if(typeof patch.pushToTalkEnabled==='boolean')desktopPreferences.pushToTalkEnabled=patch.pushToTalkEnabled;
  if(patch.pushToTalkShortcut)desktopPreferences.pushToTalkShortcut=validShortcut(patch.pushToTalkShortcut,desktopPreferences.pushToTalkShortcut);
  if(typeof patch.launchAtLogin==='boolean'&&app.isPackaged){
    app.setLoginItemSettings({
      openAtLogin:patch.launchAtLogin,
      path:process.execPath,
      args:patch.launchAtLogin?['--hidden']:[],
    });
  }
  saveDesktopPreferences();
  if(mumbleProcess&&mumbleProcess.exitCode===null){
    const mute=desktopPreferences.muteShortcut;
    const pushToTalk=desktopPreferences.pushToTalkShortcut;
    const result=await mumbleCommand(`HOTKEYS ${mute.virtualKey} ${mute.modifiers} ${pushToTalk.virtualKey} ${pushToTalk.modifiers} ${desktopPreferences.pushToTalkEnabled?1:0}`);
    if(!result.startsWith('OK'))throw new Error(`设置语音快捷键失败：${result}`);
  }
  return getDesktopPreferences();
}

async function pollMumbleControls() {
  if(!mumbleProcess||mumbleProcess.exitCode!==null)return;
  try{
    const status=await mumbleCommand('STATUS',900);
    const match=/^OK connected=[01] muted=([01]) deafened=([01]) transmitting=([01]) ptt=([01])$/.exec(status);
    if(!match)return;
    const muted=match[1]==='1';
    const deafened=match[2]==='1';
    const transmitting=match[3]==='1';
    const pushToTalkActive=match[4]==='1';
    if(muted===mumbleMuted&&deafened===mumbleDeafened&&transmitting===mumbleTransmitting&&pushToTalkActive===mumblePushToTalkActive)return;
    mumbleMuted=muted;
    mumbleDeafened=deafened;
    mumbleTransmitting=transmitting;
    mumblePushToTalkActive=pushToTalkActive;
    publishMumbleControls();
  }catch{}
}

function showMainWindow() {
  const window=mainWindow;
  if(!window||window.isDestroyed())return;
  if(window.isMinimized())window.restore();
  window.show();
  window.focus();
}

function updateTrayMenu() {
  if(!tray)return;
  const connected=mumbleRuntimeState.state==='connected'||mumbleRuntimeState.state==='reconnecting'||mumbleRuntimeState.state==='connecting';
  const voiceLabel=mumbleTransmitting?'正在说话 · 语音已连接':mumbleRuntimeState.state==='connected'?'语音已连接':mumbleRuntimeState.state==='reconnecting'?'语音正在重连':mumbleRuntimeState.state==='connecting'?'语音正在连接':'未加入语音频道';
  tray.setToolTip(mumbleTransmitting?'POIO · 正在说话':connected?'POIO · 语音已连接':'POIO · 语音社区');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'POIO',enabled:false},
    {label:'打开主窗口',click:showMainWindow},
    {type:'separator'},
    {label:voiceLabel,enabled:false},
    {
      label:mumbleMuted?'取消麦克风静音':'麦克风静音',
      enabled:connected,
      click:()=>sendToMainWindow('tray:toggle-mute',undefined),
    },
    {label:'断开语音',enabled:connected,click:()=>sendToMainWindow('tray:leave-voice',undefined)},
    {type:'separator'},
    {label:'检查客户端更新',click:()=>{showMainWindow();void checkForAppUpdate()}},
    {label:'退出 POIO',click:()=>{appQuitting=true;app.quit()}},
  ]));
}

function createTray() {
  tray=new Tray(appIcon);
  tray.setToolTip('POIO · 语音社区');
  tray.on('click',showMainWindow);
  updateTrayMenu();
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    icon: appIcon,
    webPreferences: { sandbox: true }
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:transparent;font-family:Inter,"Microsoft YaHei",sans-serif;color:#fff}
    .card{width:420px;height:260px;border-radius:26px;overflow:hidden;background:radial-gradient(circle at 28% 18%,#6646ff 0,#242045 30%,#11131b 72%);border:1px solid rgba(255,255,255,.13);box-shadow:0 28px 80px #05060dcc;display:grid;place-items:center}
    .mark{position:relative;width:92px;height:74px;border-radius:22px;background:linear-gradient(145deg,#8267ff,#5c3df4);display:grid;place-items:center;box-shadow:0 18px 38px #6c4dff55;animation:float 1.8s ease-in-out infinite;color:#fff;font-size:21px;font-weight:1000;font-style:italic;letter-spacing:-3px;transform:skew(5deg);text-shadow:0 3px 5px #281681}
    h1{font-size:26px;letter-spacing:.6px;margin:14px 0 4px}.sub{font-size:12px;color:#abaec2;letter-spacing:2px}
    .track{width:170px;height:3px;background:#ffffff18;border-radius:9px;margin:24px auto 0;overflow:hidden}.bar{height:100%;width:42%;background:linear-gradient(90deg,#7c60ff,#39d7c4);border-radius:9px;animation:load 1.2s ease-in-out infinite}
    @keyframes load{0%{transform:translateX(-110%)}100%{transform:translateX(350%)}}@keyframes float{50%{transform:translateY(-6px) rotate(-2deg)}}
  </style></head><body><div class="card"><div><div class="mark">POIO</div><h1>POIO</h1><div class="sub">VOICE · SHARE · PLAY</div><div class="track"><div class="bar"></div></div></div></div></body></html>`;
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWindow.once('ready-to-show', () => splashWindow?.show());
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    show: false,
    backgroundColor: '#101118',
    titleBarStyle: 'hidden',
    icon: appIcon,
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(path.join(dirname, '../dist/index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      splashWindow?.close();
      splashWindow = null;
      if(!process.argv.includes('--hidden'))mainWindow?.show();
    }, 900);
  });
  mainWindow.on('close',event=>{
    if(appQuitting||!desktopPreferences.closeToTray)return;
    event.preventDefault();
    mainWindow?.hide();
    if(!desktopPreferences.trayHintShown&&tray){
      desktopPreferences.trayHintShown=true;
      saveDesktopPreferences();
      tray.displayBalloon({
        iconType:'info',
        title:'POIO 正在后台运行',
        content:'语音连接不会中断。点击任务栏托盘中的 POIO 图标可重新打开。',
      });
    }
  });
  mainWindow.once('closed',()=>{mainWindow=null});
}

app.setAppUserModelId('com.poio.desktop');
if(process.env.POIO_DISABLE_PROTOCOL_REGISTRATION!=='1'){
  if(process.defaultApp&&process.argv[1])app.setAsDefaultProtocolClient('poio',process.execPath,[path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient('poio');
}
pendingInviteCode=inviteCodeFromArguments(process.argv);
const hasSingleInstanceLock=app.requestSingleInstanceLock();
if(!hasSingleInstanceLock)app.quit();
else app.on('second-instance',(_event,commandLine)=>queueInviteCode(inviteCodeFromArguments(commandLine)));
app.on('open-url',(event,url)=>{event.preventDefault();queueInviteCode(inviteCodeFromUrl(url))});

app.whenReady().then(async () => {
  loadDesktopPreferences();
  createTray();
  if(!process.argv.includes('--hidden'))createSplash();
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    callback({ video: sources[0] });
  }, { useSystemPicker: true });
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('preferences:get', () => getDesktopPreferences());
  ipcMain.handle('preferences:set', (_event,patch:Partial<DesktopPreferences>) => setDesktopPreferences(patch));
  ipcMain.handle('invite:pending', () => {
    const code=pendingInviteCode;
    pendingInviteCode=undefined;
    return code;
  });
  ipcMain.handle('desktop:sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 360, height: 200 }, fetchWindowIcons: true });
    type NativeSource={id:string;kind:'monitor'|'window';name:string;application:string};
    let nativeSources:NativeSource[]=[];
    if(nativeShare.available){
      try{nativeSources=await nativeShare.command<NativeSource[]>('sources',{})}catch{}
    }
    const monitors=nativeSources.filter(source=>source.kind==='monitor');
    const windows=nativeSources.filter(source=>source.kind==='window');
    let monitorIndex=0;
    const claimedWindows=new Set<string>();
    return sources.map((source) => {
      let nativeId:string|undefined;
      if(source.id.startsWith('screen:'))nativeId=monitors[monitorIndex++]?.id;
      else{
        const exact=windows.find(item=>!claimedWindows.has(item.id)&&item.name===source.name);
        const byApplication=exact??windows.find(item=>!claimedWindows.has(item.id)&&source.name.toLowerCase().includes(item.application.replace(/\.exe$/i,'').toLowerCase()));
        const match=exact??byApplication;if(match){nativeId=match.id;claimedWindows.add(match.id)}
      }
      return { id: source.id, nativeId, name: source.name, thumbnail: source.thumbnail.toDataURL(), appIcon: source.appIcon?.toDataURL() };
    });
  });
  ipcMain.handle('desktop:capture', async () => {
    const window=mainWindow;
    if(!window||window.isDestroyed())throw new Error('POIO 窗口不可用');
    const display=screen.getDisplayMatching(window.getBounds());
    const wasVisible=window.isVisible();
    try{
      window.hide();
      await new Promise(resolve=>setTimeout(resolve,180));
      const width=Math.max(1,Math.round(display.size.width*display.scaleFactor));
      const height=Math.max(1,Math.round(display.size.height*display.scaleFactor));
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width,height}});
      const source=sources.find(item=>item.display_id===String(display.id))??sources[0];
      if(!source||source.thumbnail.isEmpty())throw new Error('无法截取当前屏幕');
      const actual=source.thumbnail.getSize();
      return {dataUrl:source.thumbnail.toDataURL(),width:actual.width,height:actual.height,displayName:source.name};
    }finally{
      if(wasVisible&&!window.isDestroyed()){window.show();window.focus()}
    }
  });
  ipcMain.handle('native-share:available', () => nativeShare.available);
  ipcMain.handle('native-share:command', (_event,method:string,params:Record<string,unknown>) => {
    const allowed=new Set(['hello','probe','sources','start','stop','stats','sfu.setPaused','p2p.addViewer','p2p.answer','p2p.candidate','p2p.removeViewer']);
    if(!allowed.has(method))throw new Error('不允许的原生屏幕共享命令');
    return nativeShare.command(method,params??{});
  });
  ipcMain.handle('native-share:resolve', (_event,requestId:string,ok:boolean,result?:unknown,error?:string) =>
    nativeShare.resolveRequest(requestId,ok,result,error));
  ipcMain.handle('mumble:connect', (_event, connection:MumbleConnection) => connectMumble(connection));
  ipcMain.handle('mumble:state', () => mumbleRuntimeState);
  ipcMain.handle('mumble:command', async (_event, command:string) => {
    if(!/^(PING|STATUS|MUTE [01]|DEAF [01])$/.test(command))throw new Error('不允许的 Mumble 控制命令');
    const result=await mumbleCommand(command); if(!result.startsWith('OK'))throw new Error(result);
    if(command.startsWith('MUTE ')||command.startsWith('DEAF '))await pollMumbleControls();
    return result;
  });
  ipcMain.handle('mumble:disconnect', () => stopMumble());
  ipcMain.handle('mumble:level', () => getMumbleInputLevel());
  ipcMain.handle('mumble:volumes', () => getMumbleVolumes());
  ipcMain.handle('mumble:set-volume', (_event,kind:'input'|'output',value:number) => setMumbleVolume(kind,value));
  ipcMain.handle('mumble:users', () => getMumbleUsers());
  ipcMain.handle('mumble:set-user-volume', (_event,username:string,value:number) => setMumbleUserVolume(username,value));
  ipcMain.handle('mumble:devices', () => getMumbleAudioDevices());
  ipcMain.handle('mumble:set-input', (_event,index:number) => setMumbleAudioDevice('input',index));
  ipcMain.handle('mumble:set-output', (_event,index:number) => setMumbleAudioDevice('output',index));
  ipcMain.handle('update:status', () => appUpdateStatus);
  ipcMain.handle('update:check', () => checkForAppUpdate());
  ipcMain.handle('update:download', () => downloadAppUpdate());
  ipcMain.handle('update:install', () => { if(appUpdateStatus.state==='downloaded')autoUpdater.quitAndInstall(false,true); });
  ipcMain.handle('diagnostics:get', () => buildDiagnostics());
  await createMainWindow();
  initializeAutoUpdates();
  const controlPoller=setInterval(()=>void pollMumbleControls(),350);
  controlPoller.unref();
});

app.on('before-quit',()=>{appQuitting=true;stopMumble();void nativeShare.stop()});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate',showMainWindow);
