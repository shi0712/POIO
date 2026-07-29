const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');

const mediasoupClientBundle = buildSync({
  stdin: {
    contents: `
      import { Device } from 'mediasoup-client';
      window.poioMediasoupClient = { Device };
    `,
    resolveDir: __dirname,
    sourcefile: 'poio-mediasoup-receiver-entry.js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome140',
  write: false,
}).outputFiles[0].text;

let window;

function reply(id, ok, result, error) {
  if (typeof process.send === 'function') {
    process.send({ id, ok, result, error });
  }
}

async function invoke(method, params = {}) {
  const serialized = JSON.stringify({ method, params });
  return await window.webContents.executeJavaScript(
    `window.poioReceiver.invoke(${serialized})`,
    true,
  );
}

process.on('message', message => {
  if (!message || typeof message.id !== 'string') return;
  void invoke(message.method, message.params).then(
    result => reply(message.id, true, result),
    error => reply(
      message.id,
      false,
      undefined,
      error instanceof Error ? error.message : String(error),
    ),
  );
});

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <meta charset="utf-8">
    <style>html,body,video{width:100%;height:100%;margin:0;background:#000}</style>
    <video id="video" autoplay muted playsinline></video>
    <script>
      (() => {
        let pc;
        let pendingCandidates = [];
        let renderedFrames = 0;
        let firstRenderedAt = 0;
        let lastRenderedAt = 0;
        let maxRenderGapMs = 0;
        let sfuDevice;
        let sfuTransport;
        let sfuConsumer;
        let sfuPendingConnect;
        let sfuConsumeError = '';

        const video = document.getElementById('video');
        const watchFrames = () => {
          if (typeof video.requestVideoFrameCallback !== 'function') return;
          video.requestVideoFrameCallback((now) => {
            if (!firstRenderedAt) firstRenderedAt = now;
            if (lastRenderedAt) maxRenderGapMs = Math.max(maxRenderGapMs, now - lastRenderedAt);
            lastRenderedAt = now;
            renderedFrames++;
            watchFrames();
          });
        };
        watchFrames();

        const waitForIceGathering = connection => new Promise((resolve, reject) => {
          if (connection.iceGatheringState === 'complete') {
            resolve();
            return;
          }
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Electron receiver ICE gathering timed out'));
          }, 10000);
          const changed = () => {
            if (connection.iceGatheringState !== 'complete') return;
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timeout);
            connection.removeEventListener('icegatheringstatechange', changed);
          };
          connection.addEventListener('icegatheringstatechange', changed);
        });

        const createReceiver = async sdp => {
          pc?.close();
          pendingCandidates = [];
          renderedFrames = 0;
          firstRenderedAt = 0;
          lastRenderedAt = 0;
          maxRenderGapMs = 0;
          pc = new RTCPeerConnection();
          pc.ontrack = event => {
            video.srcObject = event.streams[0] || new MediaStream([event.track]);
            void video.play().catch(() => {});
          };
          await pc.setRemoteDescription({ type: 'offer', sdp });
          for (const candidate of pendingCandidates.splice(0)) {
            await pc.addIceCandidate(candidate);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceGathering(pc);
          return { sdp: pc.localDescription.sdp };
        };

        const addCandidate = async candidate => {
          if (!pc || !pc.remoteDescription) {
            pendingCandidates.push(candidate);
            return true;
          }
          await pc.addIceCandidate(candidate);
          return true;
        };

        const stats = async () => {
          if (!pc) return { connectionState: 'closed' };
          const reports = [...(await pc.getStats()).values()];
          const inbound = reports.find(report =>
            report.type === 'inbound-rtp' &&
            !report.isRemote &&
            (report.kind === 'video' || report.mediaType === 'video')
          );
          const codec = reports.find(report =>
            report.type === 'codec' && report.id === inbound?.codecId
          );
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            width: Number(inbound?.frameWidth || video.videoWidth || 0),
            height: Number(inbound?.frameHeight || video.videoHeight || 0),
            framesReceived: Number(inbound?.framesReceived || 0),
            framesDecoded: Number(inbound?.framesDecoded || 0),
            framesDropped: Number(inbound?.framesDropped || 0),
            keyFramesDecoded: Number(inbound?.keyFramesDecoded || 0),
            packetsLost: Number(inbound?.packetsLost || 0),
            packetsReceived: Number(inbound?.packetsReceived || 0),
            jitter: Number(inbound?.jitter || 0),
            bytesReceived: Number(inbound?.bytesReceived || 0),
            decoderImplementation: inbound?.decoderImplementation,
            powerEfficientDecoder: inbound?.powerEfficientDecoder,
            codec: codec?.mimeType,
            renderedFrames,
            renderDurationMs:
              firstRenderedAt && lastRenderedAt
                ? Math.max(0, lastRenderedAt - firstRenderedAt)
                : 0,
            maxRenderGapMs,
          };
        };

        const resetRenderedFrames = () => {
          renderedFrames = 0;
          firstRenderedAt = 0;
          lastRenderedAt = 0;
          maxRenderGapMs = 0;
        };

        const loadSfuDevice = async routerRtpCapabilities => {
          await closeSfu();
          sfuDevice = new window.poioMediasoupClient.Device();
          await sfuDevice.load({ routerRtpCapabilities });
          return { rtpCapabilities: sfuDevice.rtpCapabilities };
        };

        const createSfuTransport = options => {
          if (!sfuDevice) throw new Error('SFU receiver device is not loaded');
          sfuTransport = sfuDevice.createRecvTransport(options);
          sfuTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            sfuPendingConnect = { dtlsParameters, callback, errback };
          });
          return { id: sfuTransport.id };
        };

        const beginSfuConsume = info => {
          if (!sfuTransport) throw new Error('SFU receive transport is unavailable');
          sfuConsumeError = '';
          resetRenderedFrames();
          void sfuTransport.consume(info).then(consumer => {
            sfuConsumer = consumer;
            video.srcObject = new MediaStream([consumer.track]);
            void video.play().catch(() => {});
          }).catch(error => {
            sfuConsumeError = error instanceof Error ? error.message : String(error);
          });
          return true;
        };

        const resolveSfuConnect = ({ ok, error }) => {
          if (!sfuPendingConnect) throw new Error('No pending SFU DTLS connection');
          const pending = sfuPendingConnect;
          sfuPendingConnect = undefined;
          if (ok) pending.callback();
          else pending.errback(new Error(error || 'SFU transport connection failed'));
          return true;
        };

        const sfuState = async () => {
          let inbound;
          let codec;
          if (sfuConsumer) {
            const reports = [...(await sfuConsumer.getStats()).values()];
            inbound = reports.find(report =>
              report.type === 'inbound-rtp' &&
              !report.isRemote &&
              (report.kind === 'video' || report.mediaType === 'video')
            );
            codec = reports.find(report =>
              report.type === 'codec' && report.id === inbound?.codecId
            );
          }
          return {
            transportId: sfuTransport?.id,
            connectionState: sfuTransport?.connectionState || 'new',
            pendingDtlsParameters: sfuPendingConnect?.dtlsParameters,
            consumerId: sfuConsumer?.id,
            error: sfuConsumeError,
            width: Number(inbound?.frameWidth || video.videoWidth || 0),
            height: Number(inbound?.frameHeight || video.videoHeight || 0),
            framesReceived: Number(inbound?.framesReceived || 0),
            framesDecoded: Number(inbound?.framesDecoded || 0),
            framesDropped: Number(inbound?.framesDropped || 0),
            keyFramesDecoded: Number(inbound?.keyFramesDecoded || 0),
            packetsLost: Number(inbound?.packetsLost || 0),
            packetsReceived: Number(inbound?.packetsReceived || 0),
            jitter: Number(inbound?.jitter || 0),
            bytesReceived: Number(inbound?.bytesReceived || 0),
            decoderImplementation: inbound?.decoderImplementation,
            powerEfficientDecoder: inbound?.powerEfficientDecoder,
            codec: codec?.mimeType,
            renderedFrames,
            renderDurationMs:
              firstRenderedAt && lastRenderedAt
                ? Math.max(0, lastRenderedAt - firstRenderedAt)
                : 0,
            maxRenderGapMs,
          };
        };

        async function closeSfu() {
          sfuPendingConnect?.errback(new Error('SFU receiver closed'));
          sfuPendingConnect = undefined;
          sfuConsumer?.close();
          sfuTransport?.close();
          sfuConsumer = undefined;
          sfuTransport = undefined;
          sfuDevice = undefined;
          sfuConsumeError = '';
          video.srcObject = null;
          resetRenderedFrames();
          return true;
        }

        window.poioReceiver = {
          async invoke({ method, params }) {
            if (method === 'offer') return await createReceiver(params.sdp);
            if (method === 'candidate') return await addCandidate(params);
            if (method === 'stats') return await stats();
            if (method === 'sfu.load') return await loadSfuDevice(params.routerRtpCapabilities);
            if (method === 'sfu.createTransport') return createSfuTransport(params);
            if (method === 'sfu.consume') return beginSfuConsume(params);
            if (method === 'sfu.resolveConnect') return resolveSfuConnect(params);
            if (method === 'sfu.stats') return await sfuState();
            if (method === 'sfu.close') return await closeSfu();
            if (method === 'close') {
              pc?.close();
              pc = undefined;
              await closeSfu();
              video.srcObject = null;
              return true;
            }
            throw new Error('Unknown receiver method: ' + method);
          },
        };
      })();
    </script>
  `)}`);
  await window.webContents.executeJavaScript(mediasoupClientBundle, true);
  if (typeof process.send === 'function') process.send({ type: 'ready' });
}).catch(error => {
  if (typeof process.send === 'function') {
    process.send({
      type: 'startup-error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
