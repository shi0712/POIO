import { request, socket } from './api';
import type { ShareProfile } from './media';

export type P2PRoute = 'p2p'|'turn';
export type P2PRemoteMedia = {
  id:string;
  userId:string;
  kind:'audio'|'video';
  tag:'screen'|'screen-audio';
  stream:MediaStream;
  route:P2PRoute;
};
export type P2PShareStatus = {
  sharing:boolean;
  connecting:boolean;
  directViewers:number;
  turnViewers:number;
};
export type P2PShareAnnouncement = {
  socketId:string;
  userId:string;
  profile:string;
  hasAudio:boolean;
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
};

type Reply = {ok:true;value:unknown}|{ok:false;error:string};

const profileEncoding:Record<ShareProfile,{bitrate:number;fps:number}> = {
  smooth:{bitrate:3_000_000,fps:30},
  hd:{bitrate:7_000_000,fps:30},
  fps:{bitrate:12_000_000,fps:60},
  original:{bitrate:25_000_000,fps:60}
};

export class P2PScreenTransport {
  private channelId='';
  private enabled=false;
  private iceServers:RTCIceServer[]=[];
  private localStream?:MediaStream;
  private profile:ShareProfile='hd';
  private senderPeers=new Map<string,PeerRecord>();
  private viewerPeers=new Map<string,PeerRecord>();
  private earlyCandidates=new Map<string,RTCIceCandidateInit[]>();
  private remoteMedia=new Map<string,P2PRemoteMedia>();
  private onRemote:(media:P2PRemoteMedia[])=>void;
  private onRemoteConnected:(userId:string)=>void;
  private onRemoteDisconnected:(userId:string)=>void;
  private onStatus:(status:P2PShareStatus)=>void;

  constructor(callbacks:{
    onRemote:(media:P2PRemoteMedia[])=>void;
    onRemoteConnected:(userId:string)=>void;
    onRemoteDisconnected:(userId:string)=>void;
    onStatus:(status:P2PShareStatus)=>void;
  }) {
    this.onRemote=callbacks.onRemote;
    this.onRemoteConnected=callbacks.onRemoteConnected;
    this.onRemoteDisconnected=callbacks.onRemoteDisconnected;
    this.onStatus=callbacks.onStatus;
  }

  join(channelId:string,enabled:boolean,iceServers:RTCIceServer[],shares:P2PShareAnnouncement[]) {
    this.close();
    this.channelId=channelId;
    this.enabled=enabled;
    this.iceServers=iceServers;
    if(!enabled)return;
    socket.on('media:p2p:shareStarted',this.shareStarted);
    socket.on('media:p2p:shareStopped',this.shareStopped);
    socket.on('media:p2p:watchRequested',this.watchRequested);
    socket.on('media:p2p:signal',this.signalReceived);
    socket.on('media:p2p:peerDisconnected',this.peerDisconnected);
    socket.on('media:p2p:peerLeft',this.peerLeft);
    for(const share of shares)void this.requestWatch(share);
  }

  async startShare(stream:MediaStream,profile:ShareProfile) {
    if(!this.enabled)return;
    await this.stopShare();
    this.localStream=stream;
    this.profile=profile;
    this.publishStatus();
    await request('media:p2p:announce',{profile,hasAudio:stream.getAudioTracks().length>0});
  }

  async stopShare() {
    if(!this.enabled)return;
    const hadShare=Boolean(this.localStream);
    this.localStream=undefined;
    for(const socketId of [...this.senderPeers.keys()])this.dropSender(socketId,false);
    this.publishStatus();
    if(hadShare)await request('media:p2p:stop').catch(()=>{});
  }

  close() {
    socket.off('media:p2p:shareStarted',this.shareStarted);
    socket.off('media:p2p:shareStopped',this.shareStopped);
    socket.off('media:p2p:watchRequested',this.watchRequested);
    socket.off('media:p2p:signal',this.signalReceived);
    socket.off('media:p2p:peerDisconnected',this.peerDisconnected);
    socket.off('media:p2p:peerLeft',this.peerLeft);
    this.localStream=undefined;
    for(const socketId of [...this.senderPeers.keys()])this.dropSender(socketId,false);
    for(const socketId of [...this.viewerPeers.keys()])this.dropViewer(socketId,false);
    this.remoteMedia.clear();
    this.earlyCandidates.clear();
    this.channelId='';this.enabled=false;
    this.iceServers=[];
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

  private peerLeft = ({socketId}:{socketId:string}) => {
    this.dropSender(socketId,false);
    this.dropViewer(socketId,false);
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
    parameters.degradationPreference=this.profile==='hd'?'balanced':'maintain-framerate';
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
        stream:new MediaStream([track]),route:record.route
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

  private publishStatus() {
    const connected=[...this.senderPeers.values()].filter(peer=>peer.connected);
    this.onStatus({
      sharing:Boolean(this.localStream),
      connecting:Boolean(this.localStream)&&[...this.senderPeers.values()].some(peer=>!peer.connected),
      directViewers:connected.filter(peer=>peer.route==='p2p').length,
      turnViewers:connected.filter(peer=>peer.route==='turn').length
    });
  }
}
