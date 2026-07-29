import { request, socket } from './api';
import type {
  P2PPeerAnnouncement,
  P2PRoute,
  P2PShareStatus,
  ScreenDiagnostics,
} from './p2p-screen';
import type { ShareProfile } from './media';

type BridgeMessage =
  | {kind:'request';requestId:string;request:string;data:any}
  | {kind:'event';event:string;data:any}
  | {kind:'runtime';state:'started'|'stopped'|'error';error?:string};

type Viewer = {
  peerId:string;
  userId:string;
  connected:boolean;
  route:P2PRoute;
  connectTimer:number;
  disconnectTimer:number;
};

type NativeStats = {
  capturedFrames:number;
  submittedFrames:number;
  pacedFrames:number;
  rejectedFrames:number;
  width:number;
  height:number;
  p2pViewers:number;
  sfuStats?:Array<Record<string,unknown>>;
};

type StatsSample = {
  at:number;
  capturedFrames:number;
  encodedFrames:number;
  bytesSent:number;
};

const profiles:Record<ShareProfile,{minBitrate:number;startBitrate:number;bitrate:number;fps:number;width:number;height:number}> = {
  smooth:{minBitrate:500_000,startBitrate:1_500_000,bitrate:3_000_000,fps:30,width:1280,height:720},
  hd:{minBitrate:1_000_000,startBitrate:4_000_000,bitrate:9_000_000,fps:30,width:1920,height:1080},
  fps:{minBitrate:2_000_000,startBitrate:8_000_000,bitrate:18_000_000,fps:60,width:1920,height:1080},
  original:{minBitrate:3_000_000,startBitrate:12_000_000,bitrate:35_000_000,fps:60,width:0,height:0},
};

export class NativeScreenPublisher {
  private routerRtpCapabilities:any;
  private iceServers:RTCIceServer[]=[];
  private peers=new Map<string,P2PPeerAnnouncement>();
  private viewers=new Map<string,Viewer>();
  private producerId='';
  private transportId='';
  private profile:ShareProfile='hd';
  private sharing=false;
  private starting=false;
  private announced=false;
  private epoch=0;
  private sfuPaused=false;
  private diagnostics?:ScreenDiagnostics;
  private statsTimer=0;
  private statsInFlight=false;
  private lastStats?:StatsSample;
  private removeBridgeListener?:()=>void;

  constructor(
    private readonly onStatus:(status:P2PShareStatus)=>void,
    private readonly onError:(error:Error)=>void=()=>{},
  ) {
    this.removeBridgeListener=window.echodeck?.nativeShare?.onMessage(
      message=>void this.handleBridgeMessage(message as BridgeMessage),
    );
  }

  configure(
    routerRtpCapabilities:any,
    iceServers:RTCIceServer[],
    peers:P2PPeerAnnouncement[],
  ) {
    this.routerRtpCapabilities=routerRtpCapabilities;
    this.iceServers=iceServers;
    this.peers=new Map(peers.map(peer=>[peer.socketId,peer]));
  }

  async available() {
    return await window.echodeck?.nativeShare?.available()===true;
  }

  async start(sourceId:string,profile:ShareProfile) {
    await this.stop();
    const bridge=window.echodeck?.nativeShare;
    if(!bridge||!await bridge.available())throw new Error('原生屏幕共享组件不可用');
    if(!this.routerRtpCapabilities)throw new Error('屏幕共享媒体能力尚未就绪');
    const epoch=++this.epoch;
    this.profile=profile;
    this.starting=true;
    this.sharing=true;
    this.sfuPaused=false;
    this.publishStatus();
    try{
      const transport=await request<any>('media:createTransport',{direction:'send'});
      if(epoch!==this.epoch)throw new Error('屏幕共享已取消');
      this.transportId=transport.id;
      const encoding=profiles[profile];
      const result=await bridge.command<{producerId:string}>('start',{
        sourceId,
        captureCursor:false,
        routerRtpCapabilities:this.routerRtpCapabilities,
        transport,
        publish:{
          minBitrateBps:encoding.minBitrate,
          startBitrateBps:encoding.startBitrate,
          maxBitrateBps:encoding.bitrate,
          maxFrameRate:encoding.fps,
          maxWidth:encoding.width,
          maxHeight:encoding.height,
          contentMode:profile==='smooth'||profile==='fps'?'motion':'detail',
          appData:{mediaTag:'screen',profile,native:true},
        },
      });
      if(epoch!==this.epoch)throw new Error('屏幕共享已取消');
      this.producerId=result.producerId;
      await request('media:p2p:announce',{profile,hasAudio:false});
      if(epoch!==this.epoch)throw new Error('屏幕共享已取消');
      this.announced=true;
      this.starting=false;
      this.startStats();
      this.publishStatus();
      this.evaluateSfuFallback();
    }catch(error){
      if(epoch===this.epoch)await this.stop();
      throw error;
    }
  }

  async stop() {
    const hadShare=this.sharing||this.starting||Boolean(this.producerId||this.transportId);
    ++this.epoch;
    this.sharing=false;
    this.starting=false;
    for(const peerId of [...this.viewers.keys()])this.dropViewer(peerId,false);
    const producerId=this.producerId;
    const transportId=this.transportId;
    const announced=this.announced;
    this.producerId='';
    this.transportId='';
    this.announced=false;
    this.sfuPaused=false;
    this.stopStats();
    if(hadShare){
      await window.echodeck?.nativeShare?.command('stop',{}).catch(()=>{});
      await Promise.all([
        producerId?request('media:closeProducer',{producerId}).catch(()=>{}):Promise.resolve(),
        transportId?request('media:closeTransport',{transportId}).catch(()=>{}):Promise.resolve(),
        announced?request('media:p2p:stop').catch(()=>{}):Promise.resolve(),
      ]);
    }
    this.publishStatus();
  }

  async leave() {
    this.routerRtpCapabilities=undefined;
    this.iceServers=[];
    this.peers.clear();
    await this.stop();
  }

  dispose() {
    void this.leave();
    this.removeBridgeListener?.();
    this.removeBridgeListener=undefined;
  }

  isSharing() {
    return this.sharing||this.starting;
  }

  private handleBridgeMessage(message:BridgeMessage) {
    if(message.kind==='request'){
      void this.handleRequest(message);
      return;
    }
    if(message.kind==='runtime'){
      if(message.state==='error'&&this.isSharing()){
        this.onError(new Error(message.error||'原生屏幕共享进程异常退出'));
        void this.stop();
      }
      return;
    }
    if(message.event==='p2p.signal'){
      const {targetPeerId,...signal}=message.data;
      if(this.sharing&&this.viewers.has(targetPeerId))
        void request('media:p2p:signal',{targetSocketId:targetPeerId,...signal}).catch(()=>this.dropViewer(targetPeerId,true));
      return;
    }
    if(message.event==='p2p.connectionState'){
      this.connectionState(message.data);
      return;
    }
    if(message.event==='p2p.error'){
      this.dropViewer(message.data.peerId,true);
      return;
    }
    if(message.event==='capture.error'&&this.isSharing()){
      this.onError(new Error(message.data.error||'原生屏幕采集已中断'));
      void this.stop();
    }
  }

  private async handleRequest(message:Extract<BridgeMessage,{kind:'request'}>) {
    const bridge=window.echodeck?.nativeShare;
    if(!bridge)return;
    try{
      if(!this.isSharing())throw new Error('屏幕共享会话已结束');
      if(message.request==='sfu.connectTransport'){
        const result=await request('media:connectTransport',message.data);
        await bridge.resolve(message.requestId,true,result);
        return;
      }
      if(message.request==='sfu.produce'){
        const result=await request<{id:string}>('media:produce',message.data);
        await bridge.resolve(message.requestId,true,result);
        return;
      }
      throw new Error(`未知原生信令请求：${message.request}`);
    }catch(error){
      await bridge.resolve(
        message.requestId,
        false,
        undefined,
        error instanceof Error?error.message:String(error),
      ).catch(()=>{});
    }
  }

  private watchRequested = ({viewerSocketId,viewerUserId}:{viewerSocketId:string;viewerUserId:string}) => {
    if(!this.sharing||this.viewers.has(viewerSocketId))return;
    const viewer:Viewer={
      peerId:viewerSocketId,userId:viewerUserId,connected:false,route:'p2p',
      connectTimer:0,disconnectTimer:0,
    };
    this.viewers.set(viewerSocketId,viewer);
    viewer.connectTimer=window.setTimeout(()=>{
      if(!viewer.connected)this.dropViewer(viewerSocketId,true);
    },10_000);
    const encoding=profiles[this.profile];
    void window.echodeck?.nativeShare?.command('p2p.addViewer',{
      peerId:viewerSocketId,
      options:{
        iceServers:this.iceServers,
        minBitrateBps:encoding.minBitrate,
        startBitrateBps:encoding.startBitrate,
        maxBitrateBps:encoding.bitrate,
        maxFrameRate:encoding.fps,
        maximumPeers:2,
        iceCandidatePoolSize:4,
        degradationPreference:this.profile==='smooth'
          ?'preserve-frame-rate'
          :this.profile==='fps'?'balanced':'preserve-resolution',
      },
    }).catch(()=>this.dropViewer(viewerSocketId,true));
    this.publishStatus();
    this.evaluateSfuFallback();
  };

  private signalReceived = (message:{
    fromSocketId:string;
    description?:RTCSessionDescriptionInit;
    candidate?:RTCIceCandidateInit;
  }) => {
    if(!this.sharing||!this.viewers.has(message.fromSocketId))return;
    if(message.description?.type==='answer'){
      void window.echodeck?.nativeShare?.command('p2p.answer',{
        peerId:message.fromSocketId,
        sdp:message.description.sdp??'',
      }).catch(()=>this.dropViewer(message.fromSocketId,true));
    }
    if(message.candidate){
      void window.echodeck?.nativeShare?.command('p2p.candidate',{
        peerId:message.fromSocketId,
        sdpMid:message.candidate.sdpMid??'',
        sdpMLineIndex:message.candidate.sdpMLineIndex??0,
        candidate:message.candidate.candidate,
      }).catch(()=>this.dropViewer(message.fromSocketId,true));
    }
  };

  private peerDisconnected = ({socketId}:{socketId:string}) => this.dropViewer(socketId,false);

  private peerLeft = ({socketId}:{socketId:string}) => {
    this.peers.delete(socketId);
    this.dropViewer(socketId,false);
    this.evaluateSfuFallback();
  };

  private peerJoined = ({socketId,user,p2pCapable}:{socketId:string;user:{id:string};p2pCapable?:boolean}) => {
    if(!socketId||socketId===socket.id)return;
    this.peers.set(socketId,{socketId,userId:user.id,p2pCapable:p2pCapable===true});
    this.evaluateSfuFallback();
  };

  private connectionState(data:{peerId:string;state:string;route:string}) {
    const viewer=this.viewers.get(data.peerId);
    if(!viewer)return;
    if(data.state==='connected'){
      window.clearTimeout(viewer.connectTimer);
      window.clearTimeout(viewer.disconnectTimer);
      viewer.connected=true;
      viewer.route=data.route==='turn'?'turn':'p2p';
      this.publishStatus();
      this.evaluateSfuFallback();
      return;
    }
    if(data.state==='disconnected'){
      window.clearTimeout(viewer.disconnectTimer);
      viewer.disconnectTimer=window.setTimeout(()=>this.dropViewer(data.peerId,true),4_000);
      return;
    }
    if(data.state==='failed'||data.state==='closed')this.dropViewer(data.peerId,true);
  }

  private dropViewer(peerId:string,notify:boolean) {
    const viewer=this.viewers.get(peerId);
    if(!viewer)return;
    this.viewers.delete(peerId);
    window.clearTimeout(viewer.connectTimer);
    window.clearTimeout(viewer.disconnectTimer);
    void window.echodeck?.nativeShare?.command('p2p.removeViewer',{peerId}).catch(()=>{});
    if(notify)void request('media:p2p:disconnect',{peerSocketId:peerId}).catch(()=>{});
    this.publishStatus();
    this.evaluateSfuFallback();
  }

  private evaluateSfuFallback() {
    if(!this.sharing||!this.producerId)return;
    const connected=new Set(
      [...this.viewers.values()]
        .filter(viewer=>viewer.connected)
        .map(viewer=>viewer.peerId),
    );
    const requiresFallback=[...this.peers.values()].some(
      peer=>!peer.p2pCapable||!connected.has(peer.socketId),
    );
    const shouldPause=!requiresFallback;
    if(shouldPause===this.sfuPaused)return;
    this.sfuPaused=shouldPause;
    void window.echodeck?.nativeShare?.command('sfu.setPaused',{paused:shouldPause})
      .catch(()=>{
        if(this.sharing)this.sfuPaused=!shouldPause;
      });
  }

  private startStats() {
    this.stopStats();
    void this.collectStats();
    this.statsTimer=window.setInterval(()=>void this.collectStats(),1_000);
  }

  private stopStats() {
    window.clearInterval(this.statsTimer);
    this.statsTimer=0;
    this.lastStats=undefined;
    this.diagnostics=undefined;
  }

  private async collectStats() {
    if(!this.sharing||this.statsInFlight)return;
    this.statsInFlight=true;
    try{
      const stats=await window.echodeck?.nativeShare?.command<NativeStats>('stats');
      if(!stats||!this.sharing)return;
      const reports=Array.isArray(stats.sfuStats)?stats.sfuStats:[];
      const outbound=reports.find(report=>
        report.type==='outbound-rtp'&&
        report.isRemote!==true&&
        (report.kind==='video'||report.mediaType==='video'),
      );
      const remoteInbound=reports.find(report=>
        report.type==='remote-inbound-rtp'&&
        (report.kind==='video'||report.mediaType==='video'),
      );
      const transport=reports.find(report=>report.type==='transport');
      const selectedPairId=typeof transport?.selectedCandidatePairId==='string'
        ?transport.selectedCandidatePairId
        :undefined;
      const candidatePair=reports.find(report=>
        report.type==='candidate-pair'&&
        (report.id===selectedPairId||report.selected===true||
          (report.state==='succeeded'&&report.nominated===true)),
      );
      const codecId=typeof outbound?.codecId==='string'?outbound.codecId:undefined;
      const codec=reports.find(report=>report.type==='codec'&&report.id===codecId);
      const at=performance.now();
      const encodedFrames=Number(outbound?.framesEncoded??0);
      const bytesSent=Number(outbound?.bytesSent??0);
      const previous=this.lastStats;
      const seconds=previous?Math.max(.001,(at-previous.at)/1_000):0;
      const captureFps=previous&&seconds
        ?Math.max(0,(stats.submittedFrames-previous.capturedFrames)/seconds)
        :undefined;
      const encodedFps=previous&&seconds
        ?Math.max(0,(encodedFrames-previous.encodedFrames)/seconds)
        :undefined;
      const bitrateMbps=previous&&seconds&&bytesSent>=previous.bytesSent
        ?((bytesSent-previous.bytesSent)*8/seconds)/1_000_000
        :undefined;
      const fractionLost=Number(remoteInbound?.fractionLost);
      const packetsLost=Number(remoteInbound?.packetsLost);
      const packetsReceived=Number(remoteInbound?.packetsReceived);
      const packetTotal=Math.max(0,packetsLost)+Math.max(0,packetsReceived);
      const packetLossPercent=Number.isFinite(fractionLost)
        ?Math.max(0,fractionLost*100)
        :packetTotal?Math.max(0,packetsLost)/packetTotal*100:undefined;
      const rttSeconds=Number(
        remoteInbound?.roundTripTime??candidatePair?.currentRoundTripTime,
      );
      const availableOutgoing=Number(candidatePair?.availableOutgoingBitrate);
      this.diagnostics={
        width:stats.width||undefined,
        height:stats.height||undefined,
        fps:roundMetric(
          this.sfuPaused||!encodedFps
            ?captureFps
            :encodedFps,
          1,
        ),
        bitrateMbps:roundMetric(bitrateMbps,2),
        availableOutgoingMbps:roundMetric(
          Number.isFinite(availableOutgoing)?availableOutgoing/1_000_000:undefined,
          2,
        ),
        rttMs:roundMetric(
          Number.isFinite(rttSeconds)?rttSeconds*1_000:undefined,
          1,
        ),
        packetLossPercent:roundMetric(packetLossPercent,2),
        qualityLimitationReason:typeof outbound?.qualityLimitationReason==='string'
          ?outbound.qualityLimitationReason
          :undefined,
        codec:typeof codec?.mimeType==='string'?codec.mimeType:'video/H264',
        implementation:typeof outbound?.encoderImplementation==='string'
          ?outbound.encoderImplementation
          :'POIO Media Foundation D3D11 H.264',
        powerEfficient:typeof outbound?.powerEfficientEncoder==='boolean'
          ?outbound.powerEfficientEncoder
          :true,
      };
      this.lastStats={
        at,
        capturedFrames:stats.submittedFrames,
        encodedFrames,
        bytesSent,
      };
      this.publishStatus();
    }catch{
      // A stats sample may race with stop or transport renegotiation.
    }finally{
      this.statsInFlight=false;
    }
  }

  private publishStatus() {
    const viewers=[...this.viewers.values()].filter(viewer=>viewer.connected);
    this.onStatus({
      sharing:this.sharing,
      connecting:this.starting||[...this.viewers.values()].some(viewer=>!viewer.connected),
      directViewers:viewers.filter(viewer=>viewer.route==='p2p').length,
      turnViewers:viewers.filter(viewer=>viewer.route==='turn').length,
      diagnostics:this.diagnostics,
      viewers:viewers.map(viewer=>({
        userId:viewer.userId,
        route:viewer.route,
        diagnostics:this.diagnostics,
      })),
    });
  }

  attach() {
    socket.on('media:p2p:watchRequested',this.watchRequested);
    socket.on('media:p2p:signal',this.signalReceived);
    socket.on('media:p2p:peerDisconnected',this.peerDisconnected);
    socket.on('media:p2p:peerLeft',this.peerLeft);
    socket.on('media:peerJoined',this.peerJoined);
  }

  detach() {
    socket.off('media:p2p:watchRequested',this.watchRequested);
    socket.off('media:p2p:signal',this.signalReceived);
    socket.off('media:p2p:peerDisconnected',this.peerDisconnected);
    socket.off('media:p2p:peerLeft',this.peerLeft);
    socket.off('media:peerJoined',this.peerJoined);
  }
}

function roundMetric(value:number|undefined,digits:number) {
  if(value===undefined||!Number.isFinite(value))return undefined;
  const scale=10**digits;
  return Math.round(value*scale)/scale;
}
