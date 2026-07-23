package cn.poio.mobile.screen

import android.app.Application
import io.github.crow_misia.mediasoup.Consumer
import io.github.crow_misia.mediasoup.Device
import io.github.crow_misia.mediasoup.MediasoupClient
import io.github.crow_misia.mediasoup.RecvTransport
import io.github.crow_misia.mediasoup.Transport
import io.github.crow_misia.mediasoup.createDevice
import io.github.crow_misia.webrtc.RTCComponentFactory
import io.github.crow_misia.webrtc.log.DefaultLogHandler
import io.github.crow_misia.webrtc.option.MediaConstraintsOption
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.webrtc.EglBase
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnectionFactory

enum class ScreenQuality(val spatialLayer: Int?) { AUTO(null), LOW(0), MEDIUM(1), HIGH(2) }

data class RemoteScreenTrack(
    val producerId: String,
    val consumerId: String,
    val userId: String,
    val mediaTag: String,
    val track: MediaStreamTrack,
)

sealed interface ScreenReceiverState {
    data object Idle : ScreenReceiverState
    data object Connecting : ScreenReceiverState
    data class Watching(val tracks: List<RemoteScreenTrack>, val quality: ScreenQuality) : ScreenReceiverState
    data class Failed(val message: String) : ScreenReceiverState
}

interface ScreenSignaling {
    suspend fun request(event: String, payload: JSONObject = JSONObject()): Any?
    fun on(event: String, listener: (Array<out Any>) -> Unit)
    fun off(event: String)
}

/** Receive-only by design: there is deliberately no capture or produce method. */
interface ScreenReceiver {
    val state: StateFlow<ScreenReceiverState>
    suspend fun join(channelId: String)
    suspend fun setQuality(quality: ScreenQuality)
    suspend fun leave()
}

class MediasoupScreenReceiver(
    application: Application,
    private val signaling: ScreenSignaling,
    private val mediaDispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1),
) : ScreenReceiver {
    private val app = application
    private val scope = CoroutineScope(SupervisorJob() + mediaDispatcher)
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow<ScreenReceiverState>(ScreenReceiverState.Idle)
    override val state: StateFlow<ScreenReceiverState> = mutableState.asStateFlow()
    private var channelId = ""
    private var quality = ScreenQuality.AUTO
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var device: Device? = null
    private var transport: RecvTransport? = null
    private val consumers = linkedMapOf<String, Consumer>()
    private val tracks = linkedMapOf<String, RemoteScreenTrack>()
    private val pendingProducers = linkedMapOf<String, JSONObject>()

    init {
        initialize(app)
    }

    override suspend fun join(channelId: String) = withContext(mediaDispatcher) {
        mutex.withLock {
            if (this@MediasoupScreenReceiver.channelId == channelId && transport?.closed == false) return@withLock
            leaveLocked(notifyServer = true)
            mutableState.value = ScreenReceiverState.Connecting
            runCatching {
                this@MediasoupScreenReceiver.channelId = channelId
                registerProducerListeners()
                val option = MediaConstraintsOption().apply {
                    enableVideoDownstream(eglContext)
                    enableAudioDownstream()
                }
                val factory = RTCComponentFactory(option).createPeerConnectionFactory(app) { _, message ->
                    mutableState.value = ScreenReceiverState.Failed(message)
                }
                peerConnectionFactory = factory
                val mediasoupDevice = factory.createDevice()
                device = mediasoupDevice
                val routerCapabilities = signaling.request("media:capabilities") as JSONObject
                mediasoupDevice.load(routerCapabilities.toString())
                val joined = signaling.request("media:join", JSONObject().put("channelId", channelId)) as JSONObject
                val transportInfo = signaling.request("media:createTransport", JSONObject().put("direction", "recv")) as JSONObject
                val recvTransport = mediasoupDevice.createRecvTransport(
                    listener = transportListener,
                    id = transportInfo.getString("id"),
                    iceParameters = transportInfo.getJSONObject("iceParameters").toString(),
                    iceCandidates = transportInfo.getJSONArray("iceCandidates").toString(),
                    dtlsParameters = transportInfo.getJSONObject("dtlsParameters").toString(),
                    sctpParameters = transportInfo.optJSONObject("sctpParameters")?.toString(),
                )
                transport = recvTransport
                mutableState.value = ScreenReceiverState.Watching(emptyList(), quality)
                val producers = joined.optJSONArray("producers")
                if (producers != null) for (index in 0 until producers.length()) consume(producers.getJSONObject(index))
                val queued = pendingProducers.values.toList()
                pendingProducers.clear()
                queued.forEach { consume(it) }
            }.onFailure { error ->
                leaveLocked(notifyServer = true)
                mutableState.value = ScreenReceiverState.Failed(error.message ?: "屏幕共享接收失败")
                throw error
            }
        }
    }

    override suspend fun setQuality(quality: ScreenQuality) = withContext(mediaDispatcher) {
        this@MediasoupScreenReceiver.quality = quality
        publish()
        val layer = quality.spatialLayer ?: return@withContext
        tracks.values.filter { it.mediaTag == "screen" }.forEach { track ->
            signaling.request(
                "media:setPreferredLayers",
                JSONObject().put("consumerId", track.consumerId).put("spatialLayer", layer),
            )
        }
    }

    override suspend fun leave() = withContext(mediaDispatcher) {
        mutex.withLock { leaveLocked(notifyServer = true) }
    }

    fun close() {
        signaling.off("media:newProducer")
        signaling.off("media:producerClosed")
        disposeLocal()
        scope.cancel()
    }

    private suspend fun consume(producer: JSONObject) {
        val producerId = producer.getString("producerId")
        if (consumers.containsKey(producerId)) return
        val recvTransport = transport
        val mediasoupDevice = device
        if (recvTransport == null || mediasoupDevice == null) {
            pendingProducers[producerId] = producer
            return
        }
        val info = signaling.request(
            "media:consume",
            JSONObject()
                .put("transportId", recvTransport.id)
                .put("producerId", producerId)
                .put("rtpCapabilities", JSONObject(mediasoupDevice.rtpCapabilities)),
        ) as JSONObject
        if (transport !== recvTransport || recvTransport.closed) return
        val consumer = recvTransport.consume(
            listener = object : Consumer.Listener {
                override fun onTransportClose(consumer: Consumer) {
                    scope.launch { removeProducer(consumer.producerId) }
                }
            },
            id = info.getString("id"),
            producerId = producerId,
            kind = info.getString("kind"),
            rtpParameters = info.getJSONObject("rtpParameters").toString(),
            appData = info.optJSONObject("appData")?.toString(),
        )
        consumers[producerId] = consumer
        val appData = info.optJSONObject("appData") ?: producer.optJSONObject("appData")
        val remote = RemoteScreenTrack(
            producerId = producerId,
            consumerId = consumer.id,
            userId = info.optString("userId", producer.optString("userId")),
            mediaTag = appData?.optString("mediaTag", consumer.kind) ?: consumer.kind,
            track = consumer.track,
        )
        tracks[producerId] = remote
        publish()
        signaling.request("media:resumeConsumer", JSONObject().put("consumerId", consumer.id))
        if (remote.mediaTag == "screen") quality.spatialLayer?.let { layer ->
            signaling.request(
                "media:setPreferredLayers",
                JSONObject().put("consumerId", consumer.id).put("spatialLayer", layer),
            )
        }
    }

    private fun removeProducer(producerId: String) {
        pendingProducers.remove(producerId)
        tracks.remove(producerId)?.track?.setEnabled(false)
        consumers.remove(producerId)?.let { consumer ->
            runCatching { consumer.close() }
            consumer.dispose()
        }
        publish()
    }

    private fun publish() {
        if (channelId.isNotEmpty()) mutableState.value = ScreenReceiverState.Watching(tracks.values.toList(), quality)
    }

    private suspend fun leaveLocked(notifyServer: Boolean) {
        signaling.off("media:newProducer")
        signaling.off("media:producerClosed")
        val hadChannel = channelId.isNotEmpty()
        // Release tracks, renderer resources and visible state before waiting
        // for a network ACK. A slow/offline media server must never keep a
        // frozen screen or delay the Mumble hang-up path.
        disposeLocal()
        if (notifyServer && hadChannel) runCatching { signaling.request("media:leave") }
    }

    private fun disposeLocal() {
        tracks.values.forEach { remote -> remote.track.setEnabled(false) }
        tracks.clear()
        pendingProducers.clear()
        consumers.values.forEach { consumer ->
            runCatching { consumer.close() }
            runCatching { consumer.dispose() }
        }
        consumers.clear()
        transport?.let { current ->
            runCatching { current.close() }
            runCatching { current.dispose() }
        }
        transport = null
        device?.dispose()
        device = null
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
        channelId = ""
        mutableState.value = ScreenReceiverState.Idle
    }

    private val transportListener = object : RecvTransport.Listener {
        override fun onConnect(transport: Transport, dtlsParameters: String) {
            // libmediasoup-android completes its native OnConnect future as
            // soon as this callback returns. Wait for the server ACK here;
            // returning immediately lets DTLS race ahead of the server-side
            // transport.connect() and produces a silent receiver.
            runCatching {
                runBlocking {
                    signaling.request(
                        "media:connectTransport",
                        JSONObject().put("transportId", transport.id).put("dtlsParameters", JSONObject(dtlsParameters)),
                    )
                }
            }.onFailure { mutableState.value = ScreenReceiverState.Failed(it.message ?: "WebRTC 连接失败") }
        }

        override fun onConnectionStateChange(transport: Transport, newState: String) {
            // close() is part of the normal leave/channel-switch path. Native
            // callbacks can arrive after disposal, so only a failure from the
            // currently active receive transport should change visible state.
            if (transport !== this@MediasoupScreenReceiver.transport || channelId.isEmpty()) return
            when (newState.lowercase()) {
                "connected", "completed" -> publish()
                "disconnected" -> mutableState.value = ScreenReceiverState.Failed("屏幕共享连接已断开")
                "failed" -> mutableState.value = ScreenReceiverState.Failed("屏幕共享连接失败")
            }
        }
    }

    private fun registerProducerListeners() {
        signaling.on("media:newProducer") { args ->
            val producer = args.firstOrNull() as? JSONObject ?: return@on
            scope.launch { consume(producer) }
        }
        signaling.on("media:producerClosed") { args ->
            val producerId = (args.firstOrNull() as? JSONObject)?.optString("producerId") ?: return@on
            scope.launch { removeProducer(producerId) }
        }
    }

    companion object {
        private val eglBase: EglBase by lazy { EglBase.create() }
        val eglContext: EglBase.Context get() = eglBase.eglBaseContext
        @Volatile private var initialized = false

        private fun initialize(application: Application) {
            if (initialized) return
            synchronized(this) {
                if (initialized) return
                MediasoupClient.initialize(application, DefaultLogHandler)
                initialized = true
            }
        }
    }
}
