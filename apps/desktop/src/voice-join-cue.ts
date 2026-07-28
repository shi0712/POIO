const CUSTOM_SOUND_LIMIT_MS=4_200;
const MIN_CUE_INTERVAL_MS=350;
let lastCueAt=0;
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

export async function playVoiceJoinCue(customUrl?:string){
  const now=Date.now();
  if(now-lastCueAt<MIN_CUE_INTERVAL_MS)return;
  lastCueAt=now;
  activeAudio?.pause();
  activeAudio=undefined;
  if(!customUrl){
    playDefaultJoinCue();
    return;
  }
  const audio=new Audio(customUrl);
  activeAudio=audio;
  audio.volume=.58;
  audio.preload='auto';
  const stop=window.setTimeout(()=>{audio.pause();audio.currentTime=0;if(activeAudio===audio)activeAudio=undefined},CUSTOM_SOUND_LIMIT_MS);
  audio.addEventListener('ended',()=>{window.clearTimeout(stop);if(activeAudio===audio)activeAudio=undefined},{once:true});
  audio.addEventListener('error',()=>{window.clearTimeout(stop);if(activeAudio===audio)activeAudio=undefined;playDefaultJoinCue()},{once:true});
  try{await audio.play()}catch{window.clearTimeout(stop);if(activeAudio===audio)activeAudio=undefined;playDefaultJoinCue()}
}

export async function validateJoinSound(file:File){
  if(!/\.(mp3|ogg|wav|m4a|aac|webm)$/i.test(file.name))throw new Error('加入提示音仅支持 MP3、OGG、WAV、M4A、AAC 或 WebM');
  if(file.size>2*1024*1024)throw new Error('加入提示音不能超过 2 MB');
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
    if(!Number.isFinite(duration)||duration<.1||duration>4)throw new Error('加入提示音时长需为 0.1–4 秒');
  }finally{
    URL.revokeObjectURL(url);
  }
}
