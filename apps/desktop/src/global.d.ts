export {};

declare global {
  type MumbleAudioDevice = { index:number;name:string;selected:boolean };
  type MumbleAudioDevices = { inputBackend?:string;outputBackend?:string;inputs:MumbleAudioDevice[];outputs:MumbleAudioDevice[] };
  type MumbleUserVolume = { username:string;volume:number;talking:boolean };
  type MumbleRuntimeState = { state:'disconnected'|'connecting'|'connected'|'reconnecting'|'error';attempt?:number;message?:string };
  type AppUpdateStatus = { state:'idle'|'checking'|'available'|'downloading'|'downloaded'|'up-to-date'|'error'|'development';version?:string;percent?:number;message?:string;notes?:string };
  type VoiceShortcut = { virtualKey:number;modifiers:number;label:string };
  type DesktopPreferences = { closeToTray:boolean;launchAtLogin:boolean;muteShortcut:VoiceShortcut;pushToTalkEnabled:boolean;pushToTalkShortcut:VoiceShortcut };
  interface Window {
    echodeck?: {
      platform?: 'desktop'|'web';
      os?: 'win32'|'darwin'|'linux';
      window: { minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void> };
      getDesktopSources(): Promise<Array<{id:string;nativeId?:string;name:string;thumbnail:string;appIcon?:string}>>;
      captureScreenshot(): Promise<{dataUrl:string;width:number;height:number;displayName:string}>;
      nativeShare: {
        available():Promise<boolean>;
        command<T=unknown>(method:string,params?:Record<string,unknown>):Promise<T>;
        resolve(requestId:string,ok:boolean,result?:unknown,error?:string):Promise<void>;
        onMessage(callback:(message:
          |{kind:'request';requestId:string;request:string;data:unknown}
          |{kind:'event';event:string;data:unknown}
          |{kind:'runtime';state:'started'|'stopped'|'error';error?:string}
        )=>void):()=>void;
      };
      diagnostics(): Promise<string>;
      preferences: { get():Promise<DesktopPreferences>;set(patch:Partial<DesktopPreferences>):Promise<DesktopPreferences> };
      invite: { pending():Promise<string|undefined>;onReceived(callback:()=>void):()=>void };
      tray: { onToggleMute(callback:()=>void):()=>void;onLeaveVoice(callback:()=>void):()=>void };
      update: { status():Promise<AppUpdateStatus>;check():Promise<AppUpdateStatus>;download():Promise<AppUpdateStatus>;install():Promise<void>;onStatus(callback:(status:AppUpdateStatus)=>void):()=>void };
      mumble: {
        connect(connection:{host:string;port:number;username:string;password:string;channelName:string;channelId?:string}):Promise<string>;
        state():Promise<MumbleRuntimeState>;
        onState(callback:(status:MumbleRuntimeState)=>void):()=>void;
        onControls(callback:(status:{muted:boolean;deafened:boolean;transmitting:boolean;pushToTalkActive:boolean})=>void):()=>void;
        command(command:string):Promise<string>;
        disconnect():Promise<void>;
        level():Promise<number>;
        volumes():Promise<{input:number;output:number}>;
        setVolume(kind:'input'|'output',value:number):Promise<{input:number;output:number}>;
        users():Promise<MumbleUserVolume[]>;
        setUserVolume(username:string,value:number):Promise<number>;
        devices():Promise<MumbleAudioDevices>;
        setInput(index:number):Promise<MumbleAudioDevices>;
        setOutput(index:number):Promise<MumbleAudioDevices>;
      };
    };
  }
}
