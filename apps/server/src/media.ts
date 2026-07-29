import { EventEmitter } from 'node:events';
import * as mediasoup from 'mediasoup';
import type { Consumer, Producer, Router, WebRtcServer, WebRtcTransport, Worker } from 'mediasoup/types';
import { config } from './config.js';

type Peer = {
  id: string; userId: string; channelId: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  p2pCapable: boolean;
  p2pShare?: P2PShare;
  p2pViewers: Set<string>;
};

export type P2PShare = { socketId:string; userId:string; profile:string; hasAudio:boolean };

let worker: Worker;
let router: Router;
let webRtcServer: WebRtcServer;
const peers = new Map<string, Peer>();
export const mediaEvents = new EventEmitter();

function notifyProducerClosed(peer: Peer, producerId: string) {
  if (!peer.producers.delete(producerId)) return;
  mediaEvents.emit('producerClosed', { channelId: peer.channelId, userId: peer.userId, producerId });
}

export async function initMedia() {
  worker = await mediasoup.createWorker({ rtcMinPort: config.mediaMinPort, rtcMaxPort: config.mediaMaxPort, logLevel: 'warn' });
  worker.on('died', (error) => { console.error('mediasoup worker died', error); process.exit(1); });
  router = await worker.createRouter({ mediaCodecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2, parameters: { useinbandfec: 1, usedtx: 1, minptime: 10 } },
    { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'level-asymmetry-allowed': 1, 'profile-level-id': '42e01f' }, rtcpFeedback: [{type:'nack'}, {type:'nack',parameter:'pli'}, {type:'ccm',parameter:'fir'}, {type:'goog-remb'}, {type:'transport-cc'}] },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: {}, rtcpFeedback: [{type:'nack'}, {type:'nack',parameter:'pli'}, {type:'ccm',parameter:'fir'}, {type:'goog-remb'}, {type:'transport-cc'}] }
  ] });
  webRtcServer = await worker.createWebRtcServer({ listenInfos: [
    { protocol:'udp',ip:'0.0.0.0',announcedAddress:config.publicIp,port:config.mediaPort },
    { protocol:'tcp',ip:'0.0.0.0',announcedAddress:config.publicIp,port:config.mediaPort }
  ] });
  return router;
}

export const rtpCapabilities = () => router.rtpCapabilities;

export function joinMedia(socketId: string, userId: string, channelId: string, p2pCapable = false) {
  leaveMedia(socketId);
  const peer: Peer = {
    id: socketId, userId, channelId, p2pCapable,
    transports: new Map(), producers: new Map(), consumers: new Map(), p2pViewers: new Set()
  };
  peers.set(socketId, peer);
  return [...peers.values()]
    .filter((p) => p.channelId === channelId && p.id !== socketId)
    .map((p) => ({socketId:p.id,userId:p.userId,p2pCapable:p.p2pCapable}));
}

export function p2pShares(socketId:string):P2PShare[] {
  const peer=peers.get(socketId);if(!peer)return [];
  return [...peers.values()]
    .filter(other=>other.channelId===peer.channelId&&other.id!==socketId&&other.p2pShare)
    .map(other=>other.p2pShare!);
}

export function announceP2PShare(socketId:string, value:{profile:string;hasAudio:boolean}) {
  const peer=peers.get(socketId);
  if(!peer||!peer.p2pCapable)throw new Error('当前媒体会话不支持 P2P');
  peer.p2pShare={socketId,userId:peer.userId,profile:value.profile,hasAudio:value.hasAudio};
  peer.p2pViewers.clear();
  return {channelId:peer.channelId,share:peer.p2pShare};
}

export function stopP2PShare(socketId:string) {
  const peer=peers.get(socketId);if(!peer)return;
  const result={channelId:peer.channelId,viewerSocketIds:[...peer.p2pViewers]};
  peer.p2pShare=undefined;peer.p2pViewers.clear();
  return result;
}

export function requestP2PWatch(viewerSocketId:string,sharerSocketId:string) {
  const viewer=peers.get(viewerSocketId);const sharer=peers.get(sharerSocketId);
  if(!viewer||!viewer.p2pCapable)throw new Error('当前观看端不支持 P2P');
  if(!sharer||!sharer.p2pShare||sharer.channelId!==viewer.channelId)throw new Error('该直连共享已结束');
  if(sharerSocketId===viewerSocketId)throw new Error('不能观看自己的直连共享');
  if(!sharer.p2pViewers.has(viewerSocketId)&&sharer.p2pViewers.size>=2)throw new Error('直连观看人数已满，已使用服务器转发');
  sharer.p2pViewers.add(viewerSocketId);
  return {sharerSocketId,viewerSocketId,viewerUserId:viewer.userId,channelId:viewer.channelId};
}

export function disconnectP2P(socketId:string,peerSocketId:string) {
  const first=peers.get(socketId);const second=peers.get(peerSocketId);
  if(!first||!second||first.channelId!==second.channelId)return;
  if(first.p2pViewers.delete(peerSocketId))return {sharerSocketId:first.id,viewerSocketId:second.id};
  if(second.p2pViewers.delete(socketId))return {sharerSocketId:second.id,viewerSocketId:first.id};
}

export function canSignalP2P(socketId:string,targetSocketId:string) {
  const source=peers.get(socketId);const target=peers.get(targetSocketId);
  if(!source||!target||source.channelId!==target.channelId)return false;
  return source.p2pViewers.has(targetSocketId)||target.p2pViewers.has(socketId);
}

export function peerSession(socketId:string) {
  const peer=peers.get(socketId);
  return peer?{channelId:peer.channelId,p2pPeerSocketIds:[
    ...peer.p2pViewers,
    ...[...peers.values()].filter(other=>other.p2pViewers.has(socketId)).map(other=>other.id)
  ]}:undefined;
}

export async function createTransport(socketId: string) {
  const peer = peers.get(socketId); if (!peer) throw new Error('请先加入语音频道');
  const transport = await router.createWebRtcTransport({
    webRtcServer,
    enableUdp: true, enableTcp: true, preferUdp: true,
    // Start screen consumers near the 1080p operating point. WebRTC congestion
    // control still reduces this immediately when the viewer's path is slower.
    initialAvailableOutgoingBitrate: 12_000_000
  });
  if(peers.get(socketId)!==peer){transport.close();throw new Error('媒体会话已切换')}
  // Original quality is allowed to target 35 Mbps; retain control/protocol
  // headroom instead of clipping the producer below its advertised profile.
  await transport.setMaxIncomingBitrate(50_000_000);
  peer.transports.set(transport.id, transport);
  transport.on('dtlsstatechange', (state) => { if (state === 'closed') transport.close(); });
  return { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters, sctpParameters: transport.sctpParameters };
}

export async function connectTransport(socketId: string, transportId: string, dtlsParameters: any) {
  const transport = peers.get(socketId)?.transports.get(transportId); if (!transport) throw new Error('媒体传输不存在');
  await transport.connect({ dtlsParameters });
}

export function closeTransport(socketId:string,transportId:string) {
  const peer=peers.get(socketId);const transport=peer?.transports.get(transportId);
  if(!peer||!transport)return;
  peer.transports.delete(transportId);transport.close();
}

export async function produce(socketId: string, transportId: string, kind: any, rtpParameters: any, appData: any) {
  const peer = peers.get(socketId); const transport = peer?.transports.get(transportId);
  if (!peer || !transport) throw new Error('媒体传输不存在');
  const producer = await transport.produce({ kind, rtpParameters, appData });
  if(peers.get(socketId)!==peer||transport.closed){producer.close();throw new Error('媒体会话已切换')}
  peer.producers.set(producer.id, producer);
  producer.on('transportclose', () => notifyProducerClosed(peer, producer.id));
  producer.observer.on('close', () => notifyProducerClosed(peer, producer.id));
  return { id: producer.id, channelId: peer.channelId, userId: peer.userId, kind: producer.kind, appData: producer.appData };
}

export function roomProducers(socketId: string) {
  const peer = peers.get(socketId); if (!peer) return [];
  return [...peers.values()].filter((p) => p.channelId === peer.channelId && p.id !== socketId)
    .flatMap((p) => [...p.producers.values()].map((producer) => ({ producerId: producer.id, userId: p.userId, kind: producer.kind, appData: producer.appData })));
}

export async function consume(socketId: string, transportId: string, producerId: string, capabilities: any) {
  const peer = peers.get(socketId); const transport = peer?.transports.get(transportId);
  if (!peer || !transport) throw new Error('媒体传输不存在');
  const origin = [...peers.values()].find((p) => p.producers.has(producerId));
  if (!origin || origin.channelId !== peer.channelId) throw new Error('媒体流不可用');
  if (!router.canConsume({ producerId, rtpCapabilities: capabilities })) throw new Error('客户端不支持该编码');
  const consumer = await transport.consume({ producerId, rtpCapabilities: capabilities, paused: true });
  if(peers.get(socketId)!==peer||transport.closed){consumer.close();throw new Error('媒体会话已切换')}
  peer.consumers.set(consumer.id, consumer);
  consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
  consumer.on('producerclose', () => peer.consumers.delete(consumer.id));
  return { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters, type: consumer.type, appData: consumer.appData, userId: origin.userId };
}

export async function resumeConsumer(socketId: string, consumerId: string) { await peers.get(socketId)?.consumers.get(consumerId)?.resume(); }
export function closeConsumer(socketId:string,consumerId:string) {
  const peer=peers.get(socketId);const consumer=peer?.consumers.get(consumerId);
  if(!peer||!consumer)return;
  peer.consumers.delete(consumerId);consumer.close();
}
export async function setPreferredLayers(socketId:string,consumerId:string,spatialLayer:number,temporalLayer?:number) {
  const consumer=peers.get(socketId)?.consumers.get(consumerId);
  if(!consumer)throw new Error('媒体消费者不存在');
  if(consumer.kind!=='video')throw new Error('只有视频可以切换画质');
  if(consumer.type!=='simulcast'&&consumer.type!=='svc')return {consumerId,preferredLayers:undefined,currentLayers:consumer.currentLayers};
  const preferredLayers={spatialLayer,temporalLayer};
  await consumer.setPreferredLayers(preferredLayers);
  return {consumerId,preferredLayers:consumer.preferredLayers,currentLayers:consumer.currentLayers};
}
export function closeProducer(socketId: string, producerId: string) {
  const peer = peers.get(socketId); const producer = peer?.producers.get(producerId);
  if (!peer || !producer) return;
  producer.close();
  notifyProducerClosed(peer, producerId);
}
export function leaveMedia(socketId: string) {
  const peer = peers.get(socketId); if (!peer) return;
  for(const other of peers.values())other.p2pViewers.delete(socketId);
  peer.p2pViewers.clear();peer.p2pShare=undefined;
  for (const producerId of [...peer.producers.keys()]) notifyProducerClosed(peer, producerId);
  for (const transport of peer.transports.values()) transport.close();
  peers.delete(socketId);
}
