import { Device } from 'mediasoup-client';
import type { Consumer, Producer, Transport } from 'mediasoup-client/types';
import { request, socket } from './api';
import { P2PScreenTransport, type P2PPeerAnnouncement, type P2PRemoteMedia, type P2PShareAnnouncement, type P2PShareStatus, type ScreenDiagnostics } from './p2p-screen';
import { NativeScreenPublisher } from './native-screen-publisher';

export type RemoteMedia = { id:string;userId:string;kind:'audio'|'video';tag:string;stream:MediaStream;route:'sfu'|'p2p'|'turn';diagnostics?:ScreenDiagnostics };
export type ScreenShareStatus = P2PShareStatus;
export type { ScreenDiagnostics };
export type ShareProfile = 'smooth'|'hd'|'fps'|'original';
const profiles = {
  smooth: { width:1280,height:720,fps:30,bitrate:3_000_000 },
  hd: { width:1920,height:1080,fps:30,bitrate:9_000_000 },
  fps: { width:1920,height:1080,fps:60,bitrate:18_000_000 },
  original: { width:7680,height:4320,fps:60,bitrate:35_000_000 }
} as const;

// Video-only screen sharing. Voice is deliberately handled by the bundled
// native Mumble sidecar so Electron/WebRTC never replaces Mumble's audio path.
export class ScreenSession {
  private device = new Device();
  private sendTransport?: Transport;
  private recvTransport?: Transport;
  private screen?: Producer;
  private screenAudio?: Producer;
  private joinPromise?: Promise<void>;
  private epoch = 0;
  private consumers = new Map<string, Consumer>();
  private closedProducers = new Set<string>();
  private onMedia: (media: RemoteMedia[]) => void;
  private media = new Map<string, RemoteMedia>();
  private p2pMedia = new Map<string, RemoteMedia>();
  private knownProducers = new Map<string,{producerId:string;userId:string;kind:string;appData?:any}>();
  private p2pUsers = new Set<string>();
  private p2p: P2PScreenTransport;
  private native: NativeScreenPublisher;
  private browserShareStatus:P2PShareStatus={sharing:false,connecting:false,directViewers:0,turnViewers:0,viewers:[]};
  private nativeShareStatus:P2PShareStatus={sharing:false,connecting:false,directViewers:0,turnViewers:0,viewers:[]};
  private onShareStatus:(status:ScreenShareStatus)=>void;
  private onShareError:(error:Error)=>void;
  channelId = '';

  constructor(
    onMedia:(media:RemoteMedia[])=>void,
    onShareStatus:(status:ScreenShareStatus)=>void=()=>{},
    onShareError:(error:Error)=>void=()=>{},
  ) {
    this.onMedia = onMedia;
    this.onShareStatus=onShareStatus;
    this.onShareError=onShareError;
    this.p2p=new P2PScreenTransport({
      onRemote:(items:P2PRemoteMedia[])=>{
        this.p2pMedia=new Map(items.map(item=>[item.id,item]));
        this.publish();
      },
      onRemoteConnected:userId=>{
        this.p2pUsers.add(userId);
        this.suppressSfuForUser(userId);
      },
      onRemoteDisconnected:userId=>{
        this.p2pUsers.delete(userId);
        void this.restoreSfuForUser(userId);
      },
      onStatus:status=>{this.browserShareStatus=status;this.publishShareStatus()},
      onSfuFallbackRequired:required=>this.setSfuFallbackRequired(required)
    });
    this.native=new NativeScreenPublisher(
      status=>{this.nativeShareStatus=status;this.publishShareStatus()},
      error=>this.onShareError(error),
    );
    this.native.attach();
  }

  async join(channelId: string) {
    if (this.joinPromise) await this.joinPromise.catch(()=>{});
    if (this.channelId===channelId && this.sendTransport && !this.sendTransport.closed && this.recvTransport && !this.recvTransport.closed) return;
    const operation=this.performJoin(channelId);
    this.joinPromise=operation;
    try { await operation; } finally { if(this.joinPromise===operation)this.joinPromise=undefined; }
  }

  private async performJoin(channelId:string) {
    this.clear();
    const epoch=this.epoch;
    this.channelId = channelId;
    this.device = new Device();
    const active=()=>{if(epoch!==this.epoch)throw new Error('屏幕共享会话已切换')};
    try {
    const capabilities = await request<any>('media:capabilities');
    active();
    await this.device.load({ routerRtpCapabilities: capabilities });
    const joined = await request<{peers?:P2PPeerAnnouncement[];producers:Array<any>;p2pEnabled?:boolean;p2pShares?:P2PShareAnnouncement[];iceServers?:RTCIceServer[]}>('media:join',{channelId,p2p:true});
    active();
    this.sendTransport = await this.makeTransport('send',epoch);
    this.recvTransport = await this.makeTransport('recv',epoch);
    active();
    socket.on('media:newProducer', this.newProducer);
    socket.on('media:producerClosed', this.producerClosed);
    this.p2p.join(channelId,joined.p2pEnabled===true,joined.iceServers??[],joined.p2pShares??[],joined.peers??[]);
    this.native.configure(capabilities,joined.iceServers??[],joined.peers??[]);
    for (const producer of joined.producers) await this.consume(producer);
    } catch(error) {
      if(epoch===this.epoch)this.clear();
      throw error;
    }
  }

  private async makeTransport(direction: 'send'|'recv',epoch:number) {
    const options = await request<any>('media:createTransport',{direction});
    if(epoch!==this.epoch)throw new Error('屏幕共享会话已切换');
    const transport = direction === 'send' ? this.device.createSendTransport(options) : this.device.createRecvTransport(options);
    transport.on('connect', ({dtlsParameters}, callback, errback) => {
      if(epoch!==this.epoch||transport.closed){errback(new Error('屏幕共享连接已关闭'));return}
      request('media:connectTransport',{transportId:transport.id,dtlsParameters}).then(()=>callback()).catch(errback);
    });
    if (direction === 'send') transport.on('produce', ({kind,rtpParameters,appData}, callback, errback) => {
      if(epoch!==this.epoch||transport.closed){errback(new Error('屏幕共享连接已关闭'));return}
      request<{id:string}>('media:produce',{transportId:transport.id,kind,rtpParameters,appData}).then(({id})=>callback({id})).catch(errback);
    });
    return transport;
  }

  private newProducer = (producer: any) => { void this.consume(producer).catch(()=>{}); };
  private producerClosed = ({producerId}:{producerId:string}) => {
    this.closedProducers.add(producerId);
    this.knownProducers.delete(producerId);
    this.removeMedia(producerId);
  };

  private async consume(producer: {producerId:string;userId:string;kind:string;appData?:any}) {
    this.knownProducers.set(producer.producerId,producer);
    const epoch=this.epoch;
    const transport=this.recvTransport;
    const tag=String(producer.appData?.mediaTag??producer.kind);
    // Browser voice uses a dedicated media socket so it cannot reset the
    // screen-sharing transports. Voice tracks are consumed by that engine,
    // never by the screen stage (which would otherwise play them twice).
    if(tag==='voice')return;
    if(this.p2pUsers.has(producer.userId)&&(tag==='screen'||tag==='screen-audio'))return;
    if (!transport || transport.closed || this.consumers.has(producer.producerId) || this.closedProducers.has(producer.producerId)) return;
    const info = await request<any>('media:consume',{transportId:transport.id,producerId:producer.producerId,rtpCapabilities:this.device.rtpCapabilities});
    if (epoch!==this.epoch || transport!==this.recvTransport || transport.closed || this.closedProducers.has(producer.producerId)) {
      void request('media:closeConsumer',{consumerId:info.id}).catch(()=>{});
      return;
    }
    const resolvedTag=String(info.appData?.mediaTag ?? producer.appData?.mediaTag ?? info.kind);
    if(this.p2pUsers.has(producer.userId)&&(resolvedTag==='screen'||resolvedTag==='screen-audio')) {
      void request('media:closeConsumer',{consumerId:info.id}).catch(()=>{});
      return;
    }
    const consumer = await transport.consume(info);
    if (epoch!==this.epoch || transport!==this.recvTransport || transport.closed || this.closedProducers.has(producer.producerId) || this.p2pUsers.has(producer.userId)) {
      consumer.close();void request('media:closeConsumer',{consumerId:consumer.id}).catch(()=>{});return;
    }
    this.consumers.set(producer.producerId,consumer);
    const stream = new MediaStream([consumer.track]);
    const media:RemoteMedia = { id:producer.producerId,userId:info.userId ?? producer.userId,kind:consumer.kind as 'audio'|'video',tag:resolvedTag,stream,route:'sfu' };
    this.media.set(producer.producerId,media); this.publish();
    consumer.on('trackended',()=>this.removeMedia(producer.producerId));
    consumer.on('transportclose',()=>this.removeMedia(producer.producerId));
    await request('media:resumeConsumer',{consumerId:consumer.id});
    if(epoch!==this.epoch || transport!==this.recvTransport || transport.closed)this.removeMedia(producer.producerId);
  }

  private removeMedia(id:string) {
    const item=this.media.get(id);
    const consumer=this.consumers.get(id);
    if(!item&&!consumer)return;
    item?.stream.getTracks().forEach((track)=>track.stop());
    this.media.delete(id);consumer?.close();this.consumers.delete(id);
    if(consumer)void request('media:closeConsumer',{consumerId:consumer.id}).catch(()=>{});
    this.publish();
  }
  private publish() { this.onMedia([...this.media.values(),...this.p2pMedia.values()]); }

  private suppressSfuForUser(userId:string) {
    for(const item of [...this.media.values()])
      if(item.userId===userId&&(item.tag==='screen'||item.tag==='screen-audio'))this.removeMedia(item.id);
  }

  private async restoreSfuForUser(userId:string) {
    const epoch=this.epoch;
    for(const producer of this.knownProducers.values()) {
      if(epoch!==this.epoch||this.p2pUsers.has(userId))return;
      if(producer.userId===userId)await this.consume(producer).catch(()=>{});
    }
  }

  async share(sourceId:string, profile:ShareProfile, includeAudio=false, nativeSourceId?:string) {
    if (!this.sendTransport || this.sendTransport.closed) throw new Error('屏幕共享连接未就绪，请重新尝试');
    await this.stopShare();
    const setting = profiles[profile];
    if(nativeSourceId&&!includeAudio&&await this.native.available()) {
      try{
        await this.native.start(nativeSourceId,profile);
        // The native pipeline already captures this source. Starting a second
        // Chromium capture solely for the local preview wastes GPU resources,
        // breaks HDR colour handling on some systems and recursively captures
        // POIO when the user expands their own preview.
        return undefined;
      }catch(error){
        console.warn('Native screen sharing unavailable, falling back to Chromium capture',error);
      }
    }
    const browserCapture=window.echodeck?.platform==='web'||sourceId==='browser-picker';
    let stream:MediaStream;
    if(browserCapture){
      const video:any={frameRate:{ideal:setting.fps,max:setting.fps}};
      if(profile!=='original')Object.assign(video,{width:{ideal:setting.width,max:setting.width},height:{ideal:setting.height,max:setting.height}});
      stream=await navigator.mediaDevices.getDisplayMedia({video,audio:includeAudio});
    }else{
      const constraints:any = {
        audio:includeAudio?{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:sourceId}}:false,
        video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:sourceId,maxFrameRate:setting.fps}}
      };
      if (profile !== 'original') Object.assign(constraints.video.mandatory,{maxWidth:setting.width,maxHeight:setting.height});
      stream=await navigator.mediaDevices.getUserMedia(constraints);
    }
    const track = stream.getVideoTracks()[0];
    if(!track){stream.getTracks().forEach(item=>item.stop());throw new Error('没有获得可共享的视频画面')}
    track.contentHint = profile==='smooth'||profile==='fps'?'motion':'detail';
    const h264 = this.device.rtpCapabilities.codecs?.find((codec) => codec.mimeType.toLowerCase()==='video/h264' && codec.parameters?.['packetization-mode']===1);
    const encodings = profile === 'original'
      ? [{maxBitrate:setting.bitrate,maxFramerate:setting.fps,networkPriority:'high' as const}]
      : [
          {rid:'l',scaleResolutionDownBy:4,maxBitrate:Math.min(800_000,setting.bitrate/5),maxFramerate:setting.fps},
          {rid:'m',scaleResolutionDownBy:2,maxBitrate:Math.min(2_500_000,setting.bitrate/2),maxFramerate:setting.fps},
          {rid:'h',scaleResolutionDownBy:1,maxBitrate:setting.bitrate,maxFramerate:setting.fps}
        ];
    try{
      this.screen = await this.sendTransport.produce({
        track,encodings,codec:h264,appData:{mediaTag:'screen',profile},
        stopTracks:false,disableTrackOnPause:false,zeroRtpOnPause:true
      } as any);
      const audioTrack=stream.getAudioTracks()[0];
      if(includeAudio&&!audioTrack)throw new Error('所选窗口不支持系统声音，请选择整个屏幕或关闭“共享系统声音”');
      if(audioTrack)this.screenAudio=await this.sendTransport.produce({
        track:audioTrack,appData:{mediaTag:'screen-audio'},
        stopTracks:false,disableTrackOnPause:false,zeroRtpOnPause:true
      } as any);
    }catch(error){
      const ids=[this.screen?.id,this.screenAudio?.id].filter((id):id is string=>Boolean(id));
      this.screen?.close();this.screenAudio?.close();this.screen=undefined;this.screenAudio=undefined;
      stream.getTracks().forEach(item=>item.stop());
      await Promise.all(ids.map(producerId=>request('media:closeProducer',{producerId}).catch(()=>{})));
      throw error;
    }
    track.onended = () => { void this.stopShare(); };
    await this.p2p.startShare(stream,profile).catch(()=>{});
    return stream;
  }

  async stopShare() {
    if(this.native.isSharing()){
      await this.native.stop();
      return;
    }
    const producers=[this.screen,this.screenAudio].filter((producer):producer is Producer=>Boolean(producer));
    if(producers.length) {
      const producerIds=producers.map(producer=>producer.id);
      this.screen=undefined;this.screenAudio=undefined;
      for(const producer of producers)producer.close();
      await Promise.all(producerIds.map(producerId=>request('media:closeProducer',{producerId}).catch(()=>{})));
    }
    await this.p2p.stopShare();
  }

  private setSfuFallbackRequired(required:boolean) {
    for(const producer of [this.screen,this.screenAudio]) {
      if(!producer||producer.closed)continue;
      if(required&&producer.paused)producer.resume();
      if(!required&&!producer.paused)producer.pause();
    }
  }

  close() {
    const joined=Boolean(this.channelId);
    this.clear();
    if(joined)void request('media:leave').catch(()=>{});
  }

  private clear() {
    this.epoch++;
    this.p2pUsers.clear();this.knownProducers.clear();this.p2pMedia.clear();this.p2p.close();
    void this.native.leave();
    socket.off('media:newProducer',this.newProducer);
    socket.off('media:producerClosed',this.producerClosed);
    this.screen?.close(); this.screenAudio?.close(); this.sendTransport?.close(); this.recvTransport?.close();
    this.screen=undefined; this.screenAudio=undefined; this.sendTransport=undefined; this.recvTransport=undefined;
    for(const item of this.media.values())item.stream.getTracks().forEach((track)=>track.stop());
    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear(); this.media.clear(); this.closedProducers.clear(); this.onMedia([]); this.channelId='';
  }

  private publishShareStatus() {
    this.onShareStatus(
      this.nativeShareStatus.sharing||this.nativeShareStatus.connecting
        ?this.nativeShareStatus
        :this.browserShareStatus,
    );
  }
}
