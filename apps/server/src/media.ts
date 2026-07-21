import { EventEmitter } from 'node:events';
import * as mediasoup from 'mediasoup';
import type { Consumer, Producer, Router, WebRtcServer, WebRtcTransport, Worker } from 'mediasoup/types';
import { config } from './config.js';

type Peer = {
  id: string; userId: string; channelId: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
};

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

export function joinMedia(socketId: string, userId: string, channelId: string) {
  leaveMedia(socketId);
  const peer: Peer = { id: socketId, userId, channelId, transports: new Map(), producers: new Map(), consumers: new Map() };
  peers.set(socketId, peer);
  return [...peers.values()].filter((p) => p.channelId === channelId && p.id !== socketId).map((p) => ({socketId:p.id,userId:p.userId}));
}

export async function createTransport(socketId: string) {
  const peer = peers.get(socketId); if (!peer) throw new Error('请先加入语音频道');
  const transport = await router.createWebRtcTransport({
    webRtcServer,
    enableUdp: true, enableTcp: true, preferUdp: true,
    initialAvailableOutgoingBitrate: 4_000_000
  });
  if(peers.get(socketId)!==peer){transport.close();throw new Error('媒体会话已切换')}
  await transport.setMaxIncomingBitrate(30_000_000);
  peer.transports.set(transport.id, transport);
  transport.on('dtlsstatechange', (state) => { if (state === 'closed') transport.close(); });
  return { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters, sctpParameters: transport.sctpParameters };
}

export async function connectTransport(socketId: string, transportId: string, dtlsParameters: any) {
  const transport = peers.get(socketId)?.transports.get(transportId); if (!transport) throw new Error('媒体传输不存在');
  await transport.connect({ dtlsParameters });
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
export function closeProducer(socketId: string, producerId: string) {
  const peer = peers.get(socketId); const producer = peer?.producers.get(producerId);
  if (!peer || !producer) return;
  producer.close();
  notifyProducerClosed(peer, producerId);
}
export function leaveMedia(socketId: string) {
  const peer = peers.get(socketId); if (!peer) return;
  for (const producerId of [...peer.producers.keys()]) notifyProducerClosed(peer, producerId);
  for (const transport of peer.transports.values()) transport.close();
  peers.delete(socketId);
}
