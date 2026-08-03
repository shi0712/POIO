import { BrowserVoiceSession } from './browser-voice';

const voice=new BrowserVoiceSession();
const prefKey='poio.web.preferences';
const defaults:DesktopPreferences={closeToTray:false,launchAtLogin:false,muteShortcut:{virtualKey:77,modifiers:3,label:'Ctrl + Shift + M'},pushToTalkEnabled:false,pushToTalkShortcut:{virtualKey:86,modifiers:0,label:'V'}};

function readPreferences(){try{return{...defaults,...JSON.parse(localStorage.getItem(prefKey)??'{}')}}catch{return defaults}}
function inviteCode(){
  const url=new URL(location.href);
  const query=url.searchParams.get('invite');
  const path=url.pathname.match(/\/invite\/([^/]+)/)?.[1];
  return query??(path?decodeURIComponent(path):undefined);
}
function pickerThumbnail(){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const context=canvas.getContext('2d');if(!context)return '';
  const gradient=context.createLinearGradient(0,0,640,360);gradient.addColorStop(0,'#2a2348');gradient.addColorStop(1,'#11141d');
  context.fillStyle=gradient;context.fillRect(0,0,640,360);
  context.fillStyle='#8067ff';context.beginPath();context.roundRect(252,95,136,105,22);context.fill();
  context.strokeStyle='#fff';context.lineWidth=8;context.strokeRect(282,121,76,50);
  context.fillStyle='#f3f1ff';context.font='600 25px system-ui';context.textAlign='center';context.fillText('点击后选择屏幕或窗口',320,258);
  context.fillStyle='#9895ac';context.font='18px system-ui';context.fillText('浏览器会显示安全选择器',320,292);
  return canvas.toDataURL('image/png');
}
async function captureScreenshot(){
  const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
  try{
    const video=document.createElement('video');video.srcObject=stream;video.muted=true;await video.play();
    if(!video.videoWidth)await new Promise<void>(resolve=>video.addEventListener('loadedmetadata',()=>resolve(),{once:true}));
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);
    return{dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayName:'浏览器截图'};
  }finally{stream.getTracks().forEach(track=>track.stop())}
}

export function installBrowserBridge(){
  document.documentElement.classList.add('web-runtime');
  window.echodeck={
    platform:'web',
    window:{minimize:async()=>{},maximize:async()=>{},close:async()=>{}},
    getDesktopSources:async()=>[{id:'browser-picker',name:'选择要共享的屏幕或窗口',thumbnail:pickerThumbnail()}],
    captureScreenshot,
    nativeShare:{available:async()=>false,command:async()=>{throw new Error('浏览器不支持原生共享核心')},resolve:async()=>{},onMessage:()=>()=>{}},
    diagnostics:async()=>JSON.stringify({platform:'web',userAgent:navigator.userAgent,online:navigator.onLine,voice:await voice.state()},null,2),
    preferences:{
      get:async()=>readPreferences(),
      set:async patch=>{const next={...readPreferences(),...patch};localStorage.setItem(prefKey,JSON.stringify(next));return next},
    },
    invite:{pending:async()=>inviteCode(),onReceived:()=>()=>{}},
    tray:{onToggleMute:()=>()=>{},onLeaveVoice:()=>()=>{}},
    update:{status:async()=>({state:'development'}),check:async()=>({state:'up-to-date'}),download:async()=>({state:'up-to-date'}),install:async()=>{},onStatus:()=>()=>{}},
    mumble:{
      connect:connection=>voice.connect(connection),state:voice.state,onState:voice.onState,onControls:voice.onControls,
      command:command=>voice.command(command),disconnect:()=>voice.disconnect(),level:()=>voice.level(),
      volumes:()=>voice.volumes(),setVolume:(kind,value)=>voice.setVolume(kind,value),users:()=>voice.users(),
      setUserVolume:(username,value)=>voice.setUserVolume(username,value),devices:()=>voice.devices(),
      setInput:index=>voice.setInput(index),setOutput:index=>voice.setOutput(index),
    },
  };
}
