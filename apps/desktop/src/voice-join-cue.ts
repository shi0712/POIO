const CUSTOM_SOUND_LIMIT_MS=4_200;
const MIN_CUE_INTERVAL_MS=350;
const DEFAULT_JOIN_CUE_URL=new URL('./assets/audio/user-join.mp3',import.meta.url).href;
const LEAVE_CUE_URL=new URL('./assets/audio/user-leave.mp3',import.meta.url).href;
const MUTE_CUE_URL=new URL('./assets/audio/mkf-mute.mp3',import.meta.url).href;
const UNMUTE_CUE_URL=new URL('./assets/audio/mkf-cancel-mute.mp3',import.meta.url).href;
const DEAFEN_CUE_URL=new URL('./assets/audio/head-mute.mp3',import.meta.url).href;
const UNDEAFEN_CUE_URL=new URL('./assets/audio/cancel-head-mute.mp3',import.meta.url).href;
type CueKind='join'|'leave'|'mute'|'unmute'|'deafen'|'undeafen';
const lastCueAt=new Map<CueKind,number>();
let activeAudio:HTMLAudioElement|undefined;
let audioContext:AudioContext|undefined;

function cueContext(){
  audioContext??=new AudioContext();
  if(audioContext.state==='suspended')void audioContext.resume();
  return audioContext;
}

function playDefaultJoinCue(){
  try{
    const context=cueContext();
    const start=context.currentTime+.01;
    const gain=context.createGain();
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(.13,start+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,start+.32);
    gain.connect(context.destination);
    for(const [frequency,offset,duration] of [[523.25,0,.14],[659.25,.11,.2]] as const){
      const oscillator=context.createOscillator();
      oscillator.type='sine';
      oscillator.frequency.setValueAtTime(frequency,start+offset);
      oscillator.connect(gain);
      oscillator.start(start+offset);
      oscillator.stop(start+offset+duration);
    }
  }catch{
    // Some locked-down Windows audio policies can reject Web Audio playback.
  }
}

async function playAudioUrl(url:string,volume:number,fallback?:()=>void){
  activeAudio?.pause();
  activeAudio=undefined;
  const audio=new Audio(url);
  activeAudio=audio;
  audio.volume=volume;
  audio.preload='auto';
  const stop=window.setTimeout(()=>{audio.pause();audio.currentTime=0;if(activeAudio===audio)activeAudio=undefined},CUSTOM_SOUND_LIMIT_MS);
  audio.addEventListener('ended',()=>{window.clearTimeout(stop);if(activeAudio===audio)activeAudio=undefined},{once:true});
  audio.addEventListener('error',()=>{window.clearTimeout(stop);if(activeAudio===audio)activeAudio=undefined;fallback?.()},{once:true});
  try{await audio.play()}catch{window.clearTimeout(stop);if(activeAudio===audio)activeAudio=undefined;fallback?.()}
}

async function playFileCue(kind:CueKind,url:string,volume:number,fallback?:()=>void){
  const now=Date.now();
  if(now-(lastCueAt.get(kind)??0)<MIN_CUE_INTERVAL_MS)return;
  lastCueAt.set(kind,now);
  await playAudioUrl(url,volume,fallback);
}

export async function playVoiceJoinCue(customUrl?:string){
  await playFileCue('join',customUrl??DEFAULT_JOIN_CUE_URL,.68,playDefaultJoinCue);
}

export async function playVoiceLeaveCue(customUrl?:string){
  await playFileCue('leave',customUrl??LEAVE_CUE_URL,.68,customUrl?()=>void playAudioUrl(LEAVE_CUE_URL,.68):undefined);
}

export async function playMuteCue(){
  await playFileCue('mute',MUTE_CUE_URL,.62);
}

export async function playUnmuteCue(){
  await playFileCue('unmute',UNMUTE_CUE_URL,.62);
}

export async function playDeafenCue(){
  await playFileCue('deafen',DEAFEN_CUE_URL,.62);
}

export async function playUndeafenCue(){
  await playFileCue('undeafen',UNDEAFEN_CUE_URL,.62);
}

async function validateVoiceSound(file:File,label:string){
  if(!/\.(mp3|ogg|wav|m4a|aac|webm)$/i.test(file.name))throw new Error(`${label}仅支持 MP3、OGG、WAV、M4A、AAC 或 WebM`);
  if(file.size>2*1024*1024)throw new Error(`${label}不能超过 2 MB`);
  const url=URL.createObjectURL(file);
  try{
    const duration=await new Promise<number>((resolve,reject)=>{
      const audio=document.createElement('audio');
      const timer=window.setTimeout(()=>reject(new Error('无法读取提示音时长，请更换文件')),8_000);
      audio.preload='metadata';
      audio.onloadedmetadata=()=>{window.clearTimeout(timer);resolve(audio.duration)};
      audio.onerror=()=>{window.clearTimeout(timer);reject(new Error('无法读取提示音文件'))};
      audio.src=url;
    });
    if(!Number.isFinite(duration)||duration<.1||duration>4)throw new Error(`${label}时长需为 0.1–4 秒`);
  }finally{
    URL.revokeObjectURL(url);
  }
}

export const validateJoinSound=(file:File)=>validateVoiceSound(file,'加入提示音');
export const validateLeaveSound=(file:File)=>validateVoiceSound(file,'退出提示音');
