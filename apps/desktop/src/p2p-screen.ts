import { request, socket } from './api';
import type { ShareProfile } from './media';

export type P2PRoute = 'p2p'|'turn';
export type ScreenDiagnostics = {
  width?:number;
  height?:number;
  fps?:number;
  bitrateMbps?:number;
  availableOutgoingMbps?:number;
  rttMs?:number;
  packetLossPercent?:number;
  jitterMs?:number;
  qualityLimitationReason?:string;
  codec?:string;
  implementation?:string;
  powerEfficient?:boolean;
};
export type P2PRemoteMedia = {
  id:string;
  userId:string;
  kind:'audio'|'video';
  tag:'screen'|'screen-audio';
  stream:MediaStream;
  route:P2PRoute;
  diagnostics?:ScreenDiagnostics;
};
export type P2PShareStatus = {
  sharing:boolean;
  connecting:boolean;
  directViewers:number;
  turnViewers:number;
  viewers:Array<{userId:string;route:P2PRoute;diagnostics?:ScreenDiagnostics}>;
};
export type P2PShareAnnouncement = {
  socketId:string;
  userId:string;
  profile:string;
  hasAudio:boolean;
};
export type P2PPeerAnnouncement = {
  socketId:string;
  userId:string;
  p2pCapable:boolean;
};

type PeerRecord = {
  pc:RTCPeerConnection;
  socketId:string;
  userId:string;
  role:'sender'|'viewer';
  tracks:Map<string,MediaStreamTrack>;
  pendingCandidates:RTCIceCandidateInit[];
  connected:boolean;
  closed:boolean;
  route:P2PRoute;
  timeout:number;
  disconnectTimer:number;
  diagnostics?:ScreenDiagnostics;
  previousVideoSample?:{timestamp:number;bytes:number};
};

type Reply = {ok:true;value:unknown}|{ok:false;error:string};

const profileEncoding:Record<ShareProfile,{bitrate:number;fps:number}> = {
  smooth:{bitrate:3_000_000,fps:30},
  hd:{bitrate:9_000_000,fps:30},
  fps:{bitrate:18_000_000,fps:60},
  original:{bitrate:35_000_000,fps:60}
};

export class P2PScreenTransport {
  private channelId='';
  private enabled=false;
  private iceServers:RTCIceServer[]=[];
  private localStream?:MediaStream;
  private profile:ShareProfile='hd';
  private senderPeers=new Map<string,PeerRecord>();
  private viewerPeers=new Map<string,PeerRecord>();
  private peers=new Map<string,P2PPeerAnnouncement>();
  private earlyCandidates=new Map<string,RTCIceCandidateInit[]>();
  private remoteMedia=new Map<string,P2PRemoteMedia>();
  private onRemote:(media:P2PRemoteMedia[])=>void;
  private onRemoteConnected:(userId:string)=>void;
  private onRemoteDisconnected:(userId:string)=>void;
  private onStatus:(status:P2PShareStatus)=>void;
  private onSfuFallbackRequired:(required:boolean)=>void;
  private statsTimer=0;
  private collectingStats=false;
  private lastSfuFallbackRequired=true;

  constructor(callbacks:{
    onRemote:(media:P2PRemoteMedia[])=>void;
    onRemoteConnected:(userId:string)=>void;
    onRemoteDisconnected:(userId:string)=>void;
    onStatus:(status:P2PShareStatus)=>void;
    onSfuFallbackRequired:(required:boolean)=>void;
  }) {
    this.onRemote=callbacks.onRemote;
    this.onRemoteConnected=callbacks.onRemoteConnected;
    this.onRemoteDisconnected=callbacks.onRemoteDisconnected;
    this.onStatus=callbacks.onStatus;
    this.onSfuFallbackRequired=callbacks.onSfuFallbackRequired;
  }

  join(channelId:string,enabled:boolean,iceServers:RTCIceServer[],shares:P2PShareAnnouncement[],peers:P2PPeerAnnouncement[]) {
    this.close();
    this.channelId=channelId;
    this.enabled=enabled;
    this.iceServers=iceServers;
    this.peers=new Map(peers.map(peer=>[peer.socketId,peer]));
    if(!enabled)return;
    socket.on('media:p2p:shareStarted',this.shareStarted);
    socket.on('media:p2p:shareStopped',this.shareStopped);
    socket.on('media:p2p:watchRequested',this.watchRequested);
    socket.on('media:p2p:signal',this.signalReceived);
    socket.on('media:p2p:peerDisconnected',this.peerDisconnected);
    socket.on('media:p2p:peerLeft',this.peerLeft);
    socket.on('media:peerJoined',this.peerJoined);
    this.statsTimer=window.setInterval(()=>void this.collectStats(),1_000);
    for(const share of shares)void this.requestWatch(share);
  }

  async startShare(stream:MediaStream,profile:ShareProfile) {
    if(!this.enabled)return;
    await this.stopShare();
    this.localStream=stream;
    this.profile=profile;
    this.publishStatus();
    this.evaluateSfuFallback();
    await request('media:p2p:announce',{profile,hasAudio:stream.getAudioTracks().length>0});
  }

  async stopShare() {
    if(!this.enabled)return;
    const hadShare=Boolean(this.localStream);
    this.localStream=undefined;
    for(const socketId of [...this.senderPeers.keys()])this.dropSender(socketId,false);
    this.publishStatus();
    this.evaluateSfuFallback();
    if(hadShare)await request('media:p2p:stop').catch(()=>{});
  }

  close() {
    socket.off('media:p2p:shareStarted',this.shareStarted);
    socket.off('media:p2p:shareStopped',this.shareStopped);
    socket.off('media:p2p:watchRequested',this.watchRequested);
    socket.off('media:p2p:signal',this.signalReceived);
    socket.off('media:p2p:peerDisconnected',this.peerDisconnected);
    socket.off('media:p2p:peerLeft',this.peerLeft);
    socket.off('media:peerJoined',this.peerJoined);
    this.localStream=undefined;
    for(const socketId of [...this.senderPeers.keys()])this.dropSender(socketId,false);
    for(const socketId of [...this.viewerPeers.keys()])this.dropViewer(socketId,false);
    this.remoteMedia.clear();
    this.earlyCandidates.clear();
    this.peers.clear();
    this.channelId='';this.enabled=false;
    this.iceServers=[];
    window.clearInterval(this.statsTimer);this.statsTimer=0;this.collectingStats=false;
    this.lastSfuFallbackRequired=true;
    this.onSfuFallbackRequired(true);
    this.onRemote([]);
    this.publishStatus();
  }

  private shareStarted = (share:P2PShareAnnouncement) => {
    if(share.socketId===socket.id)return;
    void this.requestWatch(share);
  };

  private shareStopped = ({socketId}:{socketId:string}) => {
    this.dropViewer(socketId,false);
  };

  private peerDisconnected = ({socketId}:{socketId:string}) => {
    this.dropSender(socketId,false);
    this.dropViewer(socketId,false);
  };

  private peerJoined = ({socketId,user,p2pCapable}:{socketId:string;user:{id:string};p2pCapable?:boolean}) => {
    if(!socketId||socketId===socket.id)return;
    this.peers.set(socketId,{socketId,userId:user.id,p2pCapable:p2pCapable===true});
    this.evaluateSfuFallback();
  };

  private peerLeft = ({socketId}:{socketId:string}) => {
    this.peers.delete(socketId);
    this.dropSender(socketId,false);
    this.dropViewer(socketId,false);
    this.evaluateSfuFallback();
  };

  private async requestWatch(share:P2PShareAnnouncement) {
    if(!this.channelId||share.socketId===socket.id||this.viewerPeers.has(share.socketId))return;
    try {
      await request('media:p2p:watch',{sharerSocketId:share.socketId});
    } catch {
      // The mediasoup consumer remains active when the direct route is
      // unavailable or the sharer already has two direct viewers.
    }
  }

  private watchRequested = ({viewerSocketId,viewerUserId}:{viewerSocketId:string;viewerUserId:string}) => {
    if(!this.localStream||this.senderPeers.has(viewerSocketId))return;
    void this.createSender(viewerSocketId,viewerUserId).catch(()=>{
      this.dropSender(viewerSocketId,true);
    });
  };

  private signalReceived = (message:{
    fromSocketId:string;
    userId:string;
    description?:RTCSessionDescriptionInit;
    candidate?:RTCIceCandidateInit;
  }) => {
    void this.handleSignal(message).catch(()=>{
      this.dropSender(message.fromSocketId,true);
      this.dropViewer(message.fromSocketId,true);
    });
  };

  private async handleSignal(message:{
    fromSocketId:string;
    userId:string;
    description?:RTCSessionDescriptionInit;
    candidate?:RTCIceCandidateInit;
  }) {
    let record=this.senderPeers.get(message.fromSocketId)??this.viewerPeers.get(message.fromSocketId);
    if(message.description?.type==='offer') {
      if(record?.role==='sender')return;
      record=record??this.createRecord('viewer',message.fromSocketId,message.userId);
      await record.pc.setRemoteDescription(message.description);
      await this.flushCandidates(record);
      const answer=await record.pc.createAnswer();
      await record.pc.setLocalDescription(answer);
      this.sendSignal(message.fromSocketId,{description:record.pc.localDescription?.toJSON()});
      return;
    }
    if(!record) {
      if(message.candidate)this.earlyCandidates.set(
        message.fromSocketId,
        [...(this.earlyCandidates.get(message.fromSocketId)??[]),message.candidate].slice(-32)
      );
      return;
    }
    if(message.description?.type==='answer') {
      await record.pc.setRemoteDescription(message.description);
      await this.flushCandidates(record);
    }
    if(message.candidate) {
      if(record.pc.remoteDescription)await record.pc.addIceCandidate(message.candidate);
      else record.pendingCandidates.push(message.candidate);
    }
  }

  private async createSender(viewerSocketId:string,viewerUserId:string) {
    const stream=this.localStream;if(!stream)return;
    const record=this.createRecord('sender',viewerSocketId,viewerUserId);
    const video=stream.getVideoTracks()[0];
    if(!video)throw new Error('共享画面已经结束');
    const encoding=profileEncoding[this.profile];
    const transceiver=record.pc.addTransceiver(video,{
      direction:'sendonly',
      streams:[stream],
      sendEncodings:[{maxBitrate:encoding.bitrate,maxFramerate:encoding.fps,networkPriority:'high'} as RTCRtpEncodingParameters]
    });
    this.preferH264(transceiver);
    for(const audio of stream.getAudioTracks())record.pc.addTrack(audio,stream);
    const parameters=transceiver.sender.getParameters() as RTCRtpSendParameters&{degradationPreference?:string};
    parameters.encodings=parameters.encodings.length?parameters.encodings:[{}];
    parameters.encodings[0].maxBitrate=encoding.bitrate;
    parameters.encodings[0].maxFramerate=encoding.fps;
    parameters.degradationPreference=this.profile==='smooth'?'maintain-framerate':this.profile==='fps'?'balanced':'maintain-resolution';
    await transceiver.sender.setParameters(parameters).catch(()=>{});
    const offer=await record.pc.createOffer();
    await record.pc.setLocalDescription(offer);
    this.sendSignal(viewerSocketId,{description:record.pc.localDescription?.toJSON()});
  }

  private createRecord(role:'sender'|'viewer',socketId:string,userId:string) {
    const pc=new RTCPeerConnection({iceServers:this.iceServers,iceCandidatePoolSize:4,bundlePolicy:'max-bundle'});
    const record:PeerRecord={
      pc,socketId,userId,role,tracks:new Map(),pendingCandidates:this.earlyCandidates.get(socketId)??[],
      connected:false,closed:false,route:'p2p',timeout:0,disconnectTimer:0
    };
    (role==='sender'?this.senderPeers:this.viewerPeers).set(socketId,record);
    this.earlyCandidates.delete(socketId);
    pc.onicecandidate=event=>{
      if(event.candidate)this.sendSignal(socketId,{candidate:event.candidate.toJSON()});
    };
    pc.ontrack=event=>{
      if(role!=='viewer'||record.closed)return;
      record.tracks.set(event.track.id,event.track);
      event.track.addEventListener('ended',()=>this.removeRemoteTrack(record,event.track.id),{once:true});
      if(record.connected)this.publishViewer(record);
    };
    pc.onconnectionstatechange=()=>this.connectionChanged(record);
    record.timeout=window.setTimeout(()=>{
      if(!record.connected)(role==='sender'?this.dropSender(socketId,true):this.dropViewer(socketId,true));
    },10_000);
    this.publishStatus();
    return record;
  }

  private connectionChanged(record:PeerRecord) {
    if(record.closed)return;
    const state=record.pc.connectionState;
    if(state==='connected') {
      window.clearTimeout(record.timeout);window.clearTimeout(record.disconnectTimer);
      if(record.connected)return;
      record.connected=true;
      void this.detectRoute(record.pc).catch(()=>record.route).then(route=>{
        if(record.closed)return;
        record.route=route;
        if(record.role==='viewer') {
          this.onRemoteConnected(record.userId);
          this.publishViewer(record);
        }
        this.publishStatus();
        this.evaluateSfuFallback();
      });
      return;
    }
    if(state==='disconnected') {
      window.clearTimeout(record.disconnectTimer);
      record.disconnectTimer=window.setTimeout(()=>{
        if(record.pc.connectionState==='disconnected')
          record.role==='sender'?this.dropSender(record.socketId,true):this.dropViewer(record.socketId,true);
      },4_000);
      return;
    }
    if(state==='failed'||state==='closed')
      record.role==='sender'?this.dropSender(record.socketId,true):this.dropViewer(record.socketId,true);
  }

  private publishViewer(record:PeerRecord) {
    for(const id of [...this.remoteMedia.keys()])if(id.startsWith(`p2p:${record.socketId}:`))this.remoteMedia.delete(id);
    for(const track of record.tracks.values()) {
      const kind=track.kind as 'audio'|'video';
      if(kind!=='audio'&&kind!=='video')continue;
      const id=`p2p:${record.socketId}:${track.id}`;
      this.remoteMedia.set(id,{
        id,userId:record.userId,kind,tag:kind==='video'?'screen':'screen-audio',
        stream:new MediaStream([track]),route:record.route,diagnostics:kind==='video'?record.diagnostics:undefined
      });
    }
    this.onRemote([...this.remoteMedia.values()]);
  }

  private removeRemoteTrack(record:PeerRecord,trackId:string) {
    record.tracks.delete(trackId);
    this.remoteMedia.delete(`p2p:${record.socketId}:${trackId}`);
    this.onRemote([...this.remoteMedia.values()]);
    if(![...record.tracks.values()].some(track=>track.kind==='video'))this.dropViewer(record.socketId,true);
  }

  private dropSender(socketId:string,notify:boolean) {
    this.earlyCandidates.delete(socketId);
    const record=this.senderPeers.get(socketId);if(!record)return;
    this.senderPeers.delete(socketId);this.closeRecord(record);
    if(notify)this.notifyDisconnect(socketId);
    this.publishStatus();
    this.evaluateSfuFallback();
  }

  private dropViewer(socketId:string,notify:boolean) {
    this.earlyCandidates.delete(socketId);
    const record=this.viewerPeers.get(socketId);if(!record)return;
    this.viewerPeers.delete(socketId);const wasConnected=record.connected;
    this.closeRecord(record);
    for(const id of [...this.remoteMedia.keys()])if(id.startsWith(`p2p:${socketId}:`))this.remoteMedia.delete(id);
    this.onRemote([...this.remoteMedia.values()]);
    if(wasConnected)this.onRemoteDisconnected(record.userId);
    if(notify)this.notifyDisconnect(socketId);
  }

  private closeRecord(record:PeerRecord) {
    if(record.closed)return;
    record.closed=true;window.clearTimeout(record.timeout);window.clearTimeout(record.disconnectTimer);
    record.pc.onconnectionstatechange=null;record.pc.ontrack=null;record.pc.onicecandidate=null;
    record.pc.close();
  }

  private notifyDisconnect(peerSocketId:string) {
    socket.emit('media:p2p:disconnect',{peerSocketId},()=>{});
  }

  private sendSignal(targetSocketId:string,payload:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}) {
    socket.emit('media:p2p:signal',{targetSocketId,...payload},(reply:Reply)=>{
      if(reply&&!reply.ok)console.warn('P2P signal rejected',reply.error);
    });
  }

  private async flushCandidates(record:PeerRecord) {
    const candidates=record.pendingCandidates.splice(0);
    for(const candidate of candidates)await record.pc.addIceCandidate(candidate);
  }

  private preferH264(transceiver:RTCRtpTransceiver) {
    const codecs=RTCRtpSender.getCapabilities('video')?.codecs??[];
    const h264=codecs.filter(codec=>codec.mimeType.toLowerCase()==='video/h264');
    if(h264.length&&'setCodecPreferences' in transceiver)
      transceiver.setCodecPreferences([...h264,...codecs.filter(codec=>codec.mimeType.toLowerCase()!=='video/h264')]);
  }

  private async detectRoute(pc:RTCPeerConnection):Promise<P2PRoute> {
    const stats=await pc.getStats();
    let pair:(RTCStats&{localCandidateId?:string;remoteCandidateId?:string})|undefined;
    stats.forEach(report=>{
      if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId);
      if(!pair&&report.type==='candidate-pair'&&report.state==='succeeded'&&(report.nominated||report.selected))pair=report;
    });
    if(!pair)return 'p2p';
    const local=pair.localCandidateId?stats.get(pair.localCandidateId):undefined;
    const remote=pair.remoteCandidateId?stats.get(pair.remoteCandidateId):undefined;
    return local?.candidateType==='relay'||remote?.candidateType==='relay'?'turn':'p2p';
  }

  private async collectStats() {
    if(this.collectingStats)return;
    this.collectingStats=true;
    try {
      const records=[...this.senderPeers.values(),...this.viewerPeers.values()].filter(record=>record.connected&&!record.closed);
      await Promise.all(records.map(async record=>{
        try {
          record.diagnostics=await this.readVideoDiagnostics(record);
          if(record.role==='viewer')this.publishViewerDiagnostics(record);
        } catch {
          // A closed or renegotiating peer can reject getStats for one sample.
        }
      }));
      if(records.some(record=>record.role==='sender'))this.publishStatus();
    } finally {
      this.collectingStats=false;
    }
  }

  private async readVideoDiagnostics(record:PeerRecord):Promise<ScreenDiagnostics> {
    const stats=await record.pc.getStats();
    let video:any;
    let remoteInbound:any;
    let pair:any;
    stats.forEach((report:any)=>{
      const mediaKind=report.kind??report.mediaType;
      if(record.role==='sender'&&report.type==='outbound-rtp'&&!report.isRemote&&mediaKind==='video')video=report;
      if(record.role==='viewer'&&report.type==='inbound-rtp'&&!report.isRemote&&mediaKind==='video')video=report;
      if(record.role==='sender'&&report.type==='remote-inbound-rtp'&&mediaKind==='video')remoteInbound=report;
      if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId);
      if(!pair&&report.type==='candidate-pair'&&report.state==='succeeded'&&(report.nominated||report.selected))pair=report;
    });
    if(!video)return {};
    const bytes=Number(record.role==='sender'?video.bytesSent:video.bytesReceived);
    const timestamp=Number(video.timestamp);
    let bitrateMbps:number|undefined;
    const previous=record.previousVideoSample;
    if(previous&&Number.isFinite(bytes)&&Number.isFinite(timestamp)&&timestamp>previous.timestamp&&bytes>=previous.bytes)
      bitrateMbps=(bytes-previous.bytes)*8/(timestamp-previous.timestamp)/1_000;
    if(Number.isFinite(bytes)&&Number.isFinite(timestamp))record.previousVideoSample={bytes,timestamp};
    const codec=video.codecId?stats.get(video.codecId):undefined;
    const received=Number(video.packetsReceived);
    const lost=Number(record.role==='sender'?remoteInbound?.packetsLost:video.packetsLost);
    const totalPackets=received+Math.max(0,lost);
    const fractionLost=Number(remoteInbound?.fractionLost);
    const packetLossPercent=Number.isFinite(fractionLost)
      ? Math.max(0,fractionLost*100)
      : Number.isFinite(totalPackets)&&totalPackets>0&&Number.isFinite(lost)
        ? Math.max(0,lost/totalPackets*100)
        : undefined;
    const rttSeconds=Number(pair?.currentRoundTripTime??remoteInbound?.roundTripTime);
    const availableOutgoing=Number(pair?.availableOutgoingBitrate);
    const jitterSeconds=Number(video.jitter);
    const trackSettings=record.role==='sender'?this.localStream?.getVideoTracks()[0]?.getSettings():undefined;
    return {
      width:Number(video.frameWidth??trackSettings?.width)||undefined,
      height:Number(video.frameHeight??trackSettings?.height)||undefined,
      fps:Number(video.framesPerSecond)||undefined,
      bitrateMbps:bitrateMbps===undefined?undefined:Math.max(0,bitrateMbps),
      availableOutgoingMbps:Number.isFinite(availableOutgoing)?availableOutgoing/1_000_000:undefined,
      rttMs:Number.isFinite(rttSeconds)?Math.max(0,rttSeconds*1_000):undefined,
      packetLossPercent,
      jitterMs:Number.isFinite(jitterSeconds)?Math.max(0,jitterSeconds*1_000):undefined,
      qualityLimitationReason:record.role==='sender'?String(video.qualityLimitationReason??'none'):undefined,
      codec:codec?.mimeType?String(codec.mimeType).replace(/^video\//i,''):undefined,
      implementation:String(video.encoderImplementation??video.decoderImplementation??'')||undefined,
      powerEfficient:typeof video.powerEfficientEncoder==='boolean'
        ? video.powerEfficientEncoder
        : typeof video.powerEfficientDecoder==='boolean'
          ? video.powerEfficientDecoder
          : undefined
    };
  }

  private publishViewerDiagnostics(record:PeerRecord) {
    let changed=false;
    for(const [id,item] of this.remoteMedia)
      if(id.startsWith(`p2p:${record.socketId}:`)&&item.kind==='video') {
        this.remoteMedia.set(id,{...item,route:record.route,diagnostics:record.diagnostics});
        changed=true;
      }
    if(changed)this.onRemote([...this.remoteMedia.values()]);
  }

  private evaluateSfuFallback() {
    const connectedSocketIds=new Set(
      [...this.senderPeers.values()]
        .filter(peer=>peer.connected&&!peer.closed)
        .map(peer=>peer.socketId)
    );
    const requiresFallback=!this.localStream||[...this.peers.values()].some(peer=>!peer.p2pCapable||!connectedSocketIds.has(peer.socketId));
    if(requiresFallback===this.lastSfuFallbackRequired)return;
    this.lastSfuFallbackRequired=requiresFallback;
    this.onSfuFallbackRequired(requiresFallback);
  }

  private publishStatus() {
    const connected=[...this.senderPeers.values()].filter(peer=>peer.connected);
    this.onStatus({
      sharing:Boolean(this.localStream),
      connecting:Boolean(this.localStream)&&[...this.senderPeers.values()].some(peer=>!peer.connected),
      directViewers:connected.filter(peer=>peer.route==='p2p').length,
      turnViewers:connected.filter(peer=>peer.route==='turn').length,
      viewers:connected.map(peer=>({userId:peer.userId,route:peer.route,diagnostics:peer.diagnostics}))
    });
  }
}
