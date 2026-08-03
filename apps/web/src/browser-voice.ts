import { Device } from 'mediasoup-client';
import type { Consumer, Producer, Transport } from 'mediasoup-client/types';
import { io, type Socket } from 'socket.io-client';

type Reply<T>={ok:true;value:T}|{ok:false;error:string};
type StateListener=(state:MumbleRuntimeState)=>void;
type ControlState={muted:boolean;deafened:boolean;transmitting:boolean;pushToTalkActive:boolean};
type ControlListener=(state:ControlState)=>void;
type RemoteVoice={consumer:Consumer;audio:HTMLAudioElement;userId:string};
type InputGraph={stream:MediaStream;track:MediaStreamTrack;source:MediaStreamAudioSourceNode;gain:GainNode;analyser:AnalyserNode;destination:MediaStreamAudioDestinationNode};

const endpointUrl=import.meta.env.VITE_SERVER_URL??'https://115.159.222.29/poio';
const endpoint=new URL(endpointUrl);
const socketPath=`${endpoint.pathname.replace(/\/$/,'')}/socket.io`||'/socket.io';
const tokenKey='echodeck.session';
const clamp=(value:number,min=0,max=100)=>Math.max(min,Math.min(max,value));

export class BrowserVoiceSession {
  private socket?:Socket;
  private device=new Device();
  private sendTransport?:Transport;
  private recvTransport?:Transport;
  private producer?:Producer;
  private input?:InputGraph;
  private audioContext?:AudioContext;
  private remotes=new Map<string,RemoteVoice>();
  private stateValue:MumbleRuntimeState={state:'disconnected'};
  private controls:ControlState={muted:false,deafened:false,transmitting:false,pushToTalkActive:false};
  private stateListeners=new Set<StateListener>();
  private controlListeners=new Set<ControlListener>();
  private inputVolume=100;
  private outputVolume=100;
  private userVolumes=new Map<string,number>();
  private selectedInput='';
  private selectedOutput='';
  private levelTimer=0;
  private reconnectTimer=0;
  private restorePromise?:Promise<void>;
  private epoch=0;
  private channelId='';

  state=async()=>this.stateValue;
  onState=(listener:StateListener)=>{this.stateListeners.add(listener);listener(this.stateValue);return()=>this.stateListeners.delete(listener)};
  onControls=(listener:ControlListener)=>{this.controlListeners.add(listener);listener(this.controls);return()=>this.controlListeners.delete(listener)};

  async connect(connection:{channelId?:string}) {
    if(!connection.channelId)throw new Error('网页版缺少语音频道信息');
    if(this.channelId===connection.channelId&&this.stateValue.state==='connected')return 'OK';
    await this.disconnect();
    const epoch=++this.epoch;
    this.channelId=connection.channelId;
    this.setState({state:'connecting'});
    try{
      const token=localStorage.getItem(tokenKey);
      if(!token)throw new Error('登录状态已失效，请重新登录');
      const socket=io(endpoint.origin,{path:socketPath,autoConnect:false,transports:['websocket','polling'],reconnection:true,reconnectionDelayMax:4000});
      this.socket=socket;
      await new Promise<void>((resolve,reject)=>{
        const timer=window.setTimeout(()=>reject(new Error('网页版语音连接超时')),12_000);
        socket.once('connect',()=>{window.clearTimeout(timer);resolve()});
        socket.once('connect_error',error=>{window.clearTimeout(timer);reject(error)});
        socket.connect();
      });
      this.assertEpoch(epoch);
      await this.ask(socket,'auth:resume',{token});
      await this.joinMedia(epoch);
      this.assertEpoch(epoch);
      socket.on('media:newProducer',this.newProducer);
      socket.on('media:producerClosed',this.producerClosed);
      socket.on('disconnect',reason=>{
        if(epoch!==this.epoch||this.stateValue.state==='disconnected')return;
        this.setState({state:'reconnecting',message:`媒体连接已断开：${reason}`});
      });
      socket.on('connect',()=>{
        if(epoch!==this.epoch||this.stateValue.state!=='reconnecting')return;
        void this.restoreAfterReconnect(epoch);
      });
      this.startLevelMonitor();
      this.setState({state:'connected'});
      return 'OK';
    }catch(error){
      if(epoch===this.epoch){await this.release(false);this.setState({state:'error',message:error instanceof Error?error.message:'网页版语音连接失败'})}
      throw error;
    }
  }

  async disconnect(){
    this.epoch++;
    await this.release(true);
    this.channelId='';
    this.controls={muted:false,deafened:false,transmitting:false,pushToTalkActive:false};
    this.emitControls();
    this.setState({state:'disconnected'});
  }

  async command(command:string){
    const [name,value]=command.trim().split(/\s+/,2);
    if(name==='MUTE'){
      this.controls={...this.controls,muted:value==='1'};
      await this.applyTransmitState();this.emitControls();return 'OK';
    }
    if(name==='DEAF'){
      const enabled=value==='1';
      this.controls={...this.controls,deafened:enabled,muted:enabled?true:false};
      for(const remote of this.remotes.values())remote.audio.muted=enabled;
      await this.applyTransmitState();this.emitControls();return 'OK';
    }
    return 'OK';
  }

  async level(){return this.currentLevel()}
  async volumes(){return{input:this.inputVolume,output:this.outputVolume}}
  async setVolume(kind:'input'|'output',value:number){
    value=clamp(value);
    if(kind==='input'){
      this.inputVolume=value;
      if(this.input)this.input.gain.gain.value=value/100;
    }else{
      this.outputVolume=value;
      this.applyRemoteVolumes();
    }
    return this.volumes();
  }

  async users(){
    return [...this.remotes.values()].map(remote=>({username:`ed_${remote.userId}`,volume:this.userVolumes.get(remote.userId)??100,talking:false}));
  }
  async setUserVolume(username:string,value:number){
    const userId=username.replace(/^ed_/,'');value=clamp(value);this.userVolumes.set(userId,value);this.applyRemoteVolumes();return value;
  }

  async devices():Promise<MumbleAudioDevices>{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const inputs=devices.filter(device=>device.kind==='audioinput');
    const outputs=devices.filter(device=>device.kind==='audiooutput');
    if(!this.selectedInput)this.selectedInput=inputs[0]?.deviceId??'';
    if(!this.selectedOutput)this.selectedOutput=outputs[0]?.deviceId??'';
    return{
      inputBackend:'WebRTC',outputBackend:'浏览器音频',
      inputs:inputs.map((device,index)=>({index,name:device.label||`麦克风 ${index+1}`,selected:device.deviceId===this.selectedInput})),
      outputs:outputs.map((device,index)=>({index,name:device.label||`输出设备 ${index+1}`,selected:device.deviceId===this.selectedOutput})),
    };
  }
  async setInput(index:number){
    const devices=await navigator.mediaDevices.enumerateDevices();
    const selected=devices.filter(device=>device.kind==='audioinput')[index];
    if(!selected)throw new Error('输入设备不存在');
    this.selectedInput=selected.deviceId;
    if(this.producer&&!this.producer.closed){
      const next=await this.createInput();
      await this.producer.replaceTrack({track:next.track});
      this.disposeInput();this.input=next;
      await this.applyTransmitState();
    }
    return this.devices();
  }
  async setOutput(index:number){
    const devices=await navigator.mediaDevices.enumerateDevices();
    const selected=devices.filter(device=>device.kind==='audiooutput')[index];
    if(!selected)throw new Error('输出设备不存在');
    this.selectedOutput=selected.deviceId;
    await Promise.all([...this.remotes.values()].map(remote=>this.applySink(remote.audio)));
    return this.devices();
  }

  private async joinMedia(epoch:number){
    const socket=this.socket!;
    this.device=new Device();
    const capabilities=await this.ask<any>(socket,'media:capabilities',{});
    this.assertEpoch(epoch);
    await this.device.load({routerRtpCapabilities:capabilities});
    const joined=await this.ask<{producers:Array<any>}>(socket,'media:join',{channelId:this.channelId,p2p:false});
    this.assertEpoch(epoch);
    this.sendTransport=await this.createTransport('send',epoch);
    this.recvTransport=await this.createTransport('recv',epoch);
    this.input=await this.createInput();
    this.assertEpoch(epoch);
    this.producer=await this.sendTransport.produce({
      track:this.input.track,
      stopTracks:false,
      appData:{mediaTag:'voice'},
      codecOptions:{opusStereo:false,opusDtx:true,opusFec:true,opusPtime:20},
    });
    await this.applyTransmitState();
    for(const producer of joined.producers)await this.consume(producer,epoch);
  }

  private async restoreAfterReconnect(epoch:number){
    if(this.restorePromise)return this.restorePromise;
    const socket=this.socket;
    if(!socket?.connected||epoch!==this.epoch)return;
    window.clearTimeout(this.reconnectTimer);this.reconnectTimer=0;
    this.restorePromise=(async()=>{
      const token=localStorage.getItem(tokenKey);
      if(!token)throw new Error('登录状态已失效，请重新登录');
      this.resetMedia();
      await this.ask(socket,'auth:resume',{token});
      this.assertEpoch(epoch);
      await this.joinMedia(epoch);
      this.assertEpoch(epoch);
      this.startLevelMonitor();
      this.setState({state:'connected'});
    })().catch(error=>{
      if(epoch!==this.epoch)return;
      this.setState({state:'reconnecting',message:error instanceof Error?error.message:'语音重连失败，正在重试'});
      if(socket.connected)this.reconnectTimer=window.setTimeout(()=>void this.restoreAfterReconnect(epoch),2_500);
    }).finally(()=>{this.restorePromise=undefined});
    return this.restorePromise;
  }

  private async createTransport(direction:'send'|'recv',epoch:number){
    const socket=this.socket!;
    const options=await this.ask<any>(socket,'media:createTransport',{direction});
    this.assertEpoch(epoch);
    const transport=direction==='send'?this.device.createSendTransport(options):this.device.createRecvTransport(options);
    transport.on('connect',({dtlsParameters},callback,errback)=>{
      if(epoch!==this.epoch){errback(new Error('语音会话已切换'));return}
      this.ask(socket,'media:connectTransport',{transportId:transport.id,dtlsParameters}).then(()=>callback()).catch(errback);
    });
    if(direction==='send')transport.on('produce',({kind,rtpParameters,appData},callback,errback)=>{
      if(epoch!==this.epoch){errback(new Error('语音会话已切换'));return}
      this.ask<{id:string}>(socket,'media:produce',{transportId:transport.id,kind,rtpParameters,appData}).then(result=>callback({id:result.id})).catch(errback);
    });
    transport.on('connectionstatechange',state=>{
      if(epoch!==this.epoch)return;
      if(state==='failed'||state==='disconnected')this.setState({state:'reconnecting',message:'WebRTC 语音连接正在恢复'});
      else if(state==='connected')this.setState({state:'connected'});
    });
    return transport;
  }

  private newProducer=(producer:any)=>{void this.consume(producer,this.epoch).catch(()=>{})};
  private producerClosed=({producerId}:{producerId:string})=>this.removeRemote(producerId);

  private async consume(producer:{producerId:string;userId:string;kind:string;appData?:any},epoch:number){
    if(producer.kind!=='audio'||String(producer.appData?.mediaTag??'')!=='voice'||this.remotes.has(producer.producerId))return;
    const transport=this.recvTransport;const socket=this.socket;
    if(!transport||transport.closed||!socket)return;
    const info=await this.ask<any>(socket,'media:consume',{transportId:transport.id,producerId:producer.producerId,rtpCapabilities:this.device.rtpCapabilities});
    if(epoch!==this.epoch||transport.closed)return;
    const consumer=await transport.consume(info);
    const audio=document.createElement('audio');
    audio.autoplay=true;audio.srcObject=new MediaStream([consumer.track]);
    const remote={consumer,audio,userId:String(info.userId??producer.userId)};
    this.remotes.set(producer.producerId,remote);
    this.applyRemoteVolumes();await this.applySink(audio);void audio.play().catch(()=>{});
    consumer.on('trackended',()=>this.removeRemote(producer.producerId));
    consumer.on('transportclose',()=>this.removeRemote(producer.producerId));
    await this.ask(socket,'media:resumeConsumer',{consumerId:consumer.id});
  }

  private async createInput():Promise<InputGraph>{
    this.audioContext??=new AudioContext();
    await this.audioContext.resume().catch(()=>{});
    const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:this.selectedInput?{exact:this.selectedInput}:undefined,echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1,sampleRate:48000},video:false});
    const source=this.audioContext.createMediaStreamSource(stream);
    const gain=this.audioContext.createGain();gain.gain.value=this.inputVolume/100;
    const analyser=this.audioContext.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=.72;
    const destination=this.audioContext.createMediaStreamDestination();
    source.connect(gain);gain.connect(destination);source.connect(analyser);
    const track=destination.stream.getAudioTracks()[0];
    if(!track)throw new Error('浏览器没有获得麦克风音轨');
    return{stream,track,source,gain,analyser,destination};
  }

  private currentLevel(){
    const analyser=this.input?.analyser;if(!analyser)return 0;
    const values=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(values);
    let energy=0;for(const value of values){const sample=(value-128)/128;energy+=sample*sample}
    return clamp(Math.sqrt(energy/values.length)*4,0,1);
  }
  private startLevelMonitor(){
    window.clearInterval(this.levelTimer);
    this.levelTimer=window.setInterval(()=>{
      const transmitting=!this.controls.muted&&!this.controls.deafened&&this.currentLevel()>.025;
      if(transmitting!==this.controls.transmitting){this.controls={...this.controls,transmitting};this.emitControls()}
    },90);
  }

  private async applyTransmitState(){
    if(!this.producer||this.producer.closed)return;
    const disabled=this.controls.muted||this.controls.deafened;
    if(disabled&&!this.producer.paused)await this.producer.pause();
    if(!disabled&&this.producer.paused)await this.producer.resume();
    if(this.input)this.input.track.enabled=!disabled;
  }
  private applyRemoteVolumes(){
    for(const remote of this.remotes.values())remote.audio.volume=clamp(this.outputVolume*(this.userVolumes.get(remote.userId)??100)/100)/100;
  }
  private async applySink(audio:HTMLAudioElement){
    const sink=(audio as HTMLAudioElement&{setSinkId?:(id:string)=>Promise<void>}).setSinkId;
    if(sink&&this.selectedOutput)await sink.call(audio,this.selectedOutput).catch(()=>{});
  }
  private removeRemote(id:string){
    const remote=this.remotes.get(id);if(!remote)return;
    remote.audio.pause();remote.audio.srcObject=null;remote.consumer.close();this.remotes.delete(id);
  }
  private disposeInput(){
    if(!this.input)return;
    this.input.stream.getTracks().forEach(track=>track.stop());this.input.track.stop();
    this.input.source.disconnect();this.input.gain.disconnect();this.input.analyser.disconnect();this.input.destination.disconnect();this.input=undefined;
  }
  private resetMedia(){
    window.clearInterval(this.levelTimer);this.levelTimer=0;
    this.producer?.close();this.sendTransport?.close();this.recvTransport?.close();
    this.producer=undefined;this.sendTransport=undefined;this.recvTransport=undefined;
    for(const id of [...this.remotes.keys()])this.removeRemote(id);
    this.disposeInput();
  }
  private async release(notifyServer:boolean){
    window.clearInterval(this.levelTimer);this.levelTimer=0;
    window.clearTimeout(this.reconnectTimer);this.reconnectTimer=0;this.restorePromise=undefined;
    const socket=this.socket;
    if(notifyServer&&socket?.connected)await this.ask(socket,'media:leave',{}).catch(()=>{});
    socket?.off('media:newProducer',this.newProducer);socket?.off('media:producerClosed',this.producerClosed);
    this.resetMedia();socket?.disconnect();this.socket=undefined;
  }
  private ask<T=unknown>(socket:Socket,event:string,payload:unknown){
    return new Promise<T>((resolve,reject)=>{
      const timer=window.setTimeout(()=>reject(new Error(`${event} 响应超时`)),15_000);
      socket.emit(event,payload,(reply:Reply<T>)=>{window.clearTimeout(timer);if(reply?.ok)resolve(reply.value);else reject(new Error(reply?.error||`${event} 请求失败`))});
    });
  }
  private assertEpoch(epoch:number){if(epoch!==this.epoch)throw new Error('语音会话已切换')}
  private setState(state:MumbleRuntimeState){this.stateValue=state;for(const listener of this.stateListeners)listener(state)}
  private emitControls(){for(const listener of this.controlListeners)listener(this.controls)}
}
