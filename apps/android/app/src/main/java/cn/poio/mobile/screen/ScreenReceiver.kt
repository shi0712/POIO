package cn.poio.mobile.screen

import android.app.Application
import io.github.crow_misia.mediasoup.Consumer
import io.github.crow_misia.mediasoup.Device
import io.github.crow_misia.mediasoup.MediasoupClient
import io.github.crow_misia.mediasoup.RecvTransport
import io.github.crow_misia.mediasoup.Transport
import io.github.crow_misia.mediasoup.createDevice
import io.github.crow_misia.webrtc.RTCComponentFactory
import io.github.crow_misia.webrtc.createAnswer
import io.github.crow_misia.webrtc.log.DefaultLogHandler
import io.github.crow_misia.webrtc.observer.PeerConnectionDefaultObserver
import io.github.crow_misia.webrtc.option.MediaConstraintsOption
import io.github.crow_misia.webrtc.setLocalDescription
import io.github.crow_misia.webrtc.setRemoteDescription
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
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
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SessionDescription

enum class ScreenQuality(val spatialLayer: Int?) { AUTO(null), LOW(0), MEDIUM(1), HIGH(2) }

data class RemoteScreenTrack(
    val producerId: String,
    val consumerId: String,
    val userId: String,
    val mediaTag: String,
    val track: MediaStreamTrack,
    val route: String = "sfu",
)

sealed interface ScreenReceiverState {
    data object Idle : ScreenReceiverState
    data object Connecting : ScreenReceiverState
    data class Watching(
        val tracks: List<RemoteScreenTrack>,
        val quality: ScreenQuality,
        val screenAudioEnabled: Boolean = true,
    ) : ScreenReceiverState
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
    suspend fun setScreenAudioEnabled(enabled: Boolean)
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
    private var screenAudioEnabled = true
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var device: Device? = null
    private var transport: RecvTransport? = null
    private val consumers = linkedMapOf<String, Consumer>()
    private val tracks = linkedMapOf<String, RemoteScreenTrack>()
    private val pendingProducers = linkedMapOf<String, JSONObject>()
    private val p2pPeers = linkedMapOf<String, P2PPeer>()
    private val p2pWatchRequests = hashSetOf<String>()
    private val earlyP2PCandidates = linkedMapOf<String, MutableList<IceCandidate>>()
    private var p2pIceServers: List<PeerConnection.IceServer> = emptyList()

    private data class P2PPeer(
        val socketId: String,
        var userId: String,
        val connection: PeerConnection,
        val tracks: LinkedHashMap<String, RemoteScreenTrack> = linkedMapOf(),
        val pendingCandidates: MutableList<IceCandidate> = mutableListOf(),
        var connected: Boolean = false,
        var timeoutJob: Job? = null,
        var disconnectJob: Job? = null,
    )

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
                registerMediaListeners()
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
                val joined = signaling.request(
                    "media:join",
                    JSONObject().put("channelId", channelId).put("p2p", true),
                ) as JSONObject
                p2pIceServers = parseIceServers(joined)
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
                mutableState.value = ScreenReceiverState.Watching(emptyList(), quality, screenAudioEnabled)
                val producers = joined.optJSONArray("producers")
                if (producers != null) for (index in 0 until producers.length()) consume(producers.getJSONObject(index))
                val queued = pendingProducers.values.toList()
                pendingProducers.clear()
                queued.forEach { consume(it) }
                val p2pShares = joined.optJSONArray("p2pShares")
                if (p2pShares != null) for (index in 0 until p2pShares.length()) {
                    requestP2PWatch(p2pShares.getJSONObject(index))
                }
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

    override suspend fun setScreenAudioEnabled(enabled: Boolean) = withContext(mediaDispatcher) {
        screenAudioEnabled = enabled
        (tracks.values + p2pPeers.values.flatMap { it.tracks.values })
            .filter { it.mediaTag == "screen-audio" }
            .forEach { it.track.setEnabled(enabled) }
        publish()
    }

    override suspend fun leave() = withContext(mediaDispatcher) {
        mutex.withLock { leaveLocked(notifyServer = true) }
    }

    fun close() {
        unregisterMediaListeners()
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
        val consumerMediaTag = info.optJSONObject("appData")
            ?.optString("mediaTag")
            ?.takeIf { it.isNotBlank() }
        val producerMediaTag = producer.optJSONObject("appData")
            ?.optString("mediaTag")
            ?.takeIf { it.isNotBlank() }
        val remote = RemoteScreenTrack(
            producerId = producerId,
            consumerId = consumer.id,
            userId = info.optString("userId", producer.optString("userId")),
            mediaTag = resolveScreenMediaTag(consumerMediaTag, producerMediaTag, consumer.kind),
            track = consumer.track,
        )
        remote.track.setEnabled(
            shouldEnableRemoteScreenTrack(remote.mediaTag, consumer.kind, screenAudioEnabled),
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

    private fun parseIceServers(joined: JSONObject): List<PeerConnection.IceServer> {
        val values = joined.optJSONArray("iceServers") ?: return emptyList()
        return buildList {
            for (index in 0 until values.length()) {
                val value = values.optJSONObject(index) ?: continue
                val urls = buildList {
                    val array = value.optJSONArray("urls")
                    if (array != null) {
                        for (urlIndex in 0 until array.length()) {
                            array.optString(urlIndex).takeIf { it.isNotBlank() }?.let(::add)
                        }
                    } else {
                        value.optString("urls").takeIf { it.isNotBlank() }?.let(::add)
                    }
                }
                if (urls.isEmpty()) continue
                val builder = PeerConnection.IceServer.builder(urls)
                value.optString("username").takeIf { it.isNotBlank() }?.let(builder::setUsername)
                value.optString("credential").takeIf { it.isNotBlank() }?.let(builder::setPassword)
                add(builder.createIceServer())
            }
        }
    }

    private suspend fun requestP2PWatch(share: JSONObject) {
        val socketId = share.optString("socketId")
        if (socketId.isBlank() || !p2pWatchRequests.add(socketId)) return
        runCatching {
            signaling.request(
                "media:p2p:watch",
                JSONObject().put("sharerSocketId", socketId),
            )
        }.onFailure {
            // The SFU consumer remains visible when direct viewing is full or
            // unavailable, so a P2P negotiation failure is intentionally quiet.
            p2pWatchRequests.remove(socketId)
        }
    }

    private suspend fun handleP2PSignal(message: JSONObject) {
        val socketId = message.optString("fromSocketId")
        if (socketId.isBlank() || channelId.isEmpty()) return
        val userId = message.optString("userId")
        val description = message.optJSONObject("description")
        val candidateJson = message.optJSONObject("candidate")

        var peer = p2pPeers[socketId]
        if (description?.optString("type") == "offer") {
            if (peer == null) peer = createP2PPeer(socketId, userId)
            if (userId.isNotBlank()) peer.userId = userId
            peer.connection.setRemoteDescription(
                SessionDescription(SessionDescription.Type.OFFER, description.getString("sdp")),
            )
            flushP2PCandidates(peer)
            val answer = peer.connection.createAnswer(MediaConstraints())
            peer.connection.setLocalDescription(answer)
            sendP2PSignal(
                socketId,
                description = JSONObject()
                    .put("type", answer.type.canonicalForm())
                    .put("sdp", answer.description),
            )
        }

        if (candidateJson != null) {
            val candidate = IceCandidate(
                candidateJson.optString("sdpMid").takeIf { it.isNotBlank() },
                candidateJson.optInt("sdpMLineIndex", 0),
                candidateJson.getString("candidate"),
            )
            val current = p2pPeers[socketId]
            if (current == null) {
                earlyP2PCandidates.getOrPut(socketId) { mutableListOf() }
                    .apply {
                        add(candidate)
                        while (size > 32) removeAt(0)
                    }
            } else if (current.connection.remoteDescription != null) {
                current.connection.addIceCandidate(candidate)
            } else {
                current.pendingCandidates.add(candidate)
            }
        }
    }

    private fun createP2PPeer(socketId: String, userId: String): P2PPeer {
        val factory = checkNotNull(peerConnectionFactory) { "WebRTC factory is not ready" }
        val configuration = PeerConnection.RTCConfiguration(p2pIceServers).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            iceCandidatePoolSize = 4
        }
        val observer = object : PeerConnectionDefaultObserver {
            override fun onIceCandidate(candidate: IceCandidate) {
                scope.launch {
                    runCatching {
                        sendP2PSignal(
                            socketId,
                            candidate = JSONObject()
                                .put("sdpMid", candidate.sdpMid)
                                .put("sdpMLineIndex", candidate.sdpMLineIndex)
                                .put("candidate", candidate.sdp),
                        )
                    }.onFailure { closeP2PPeer(socketId, notifyServer = true) }
                }
            }

            override fun onTrack(transceiver: RtpTransceiver) {
                val track = transceiver.receiver.track() ?: return
                scope.launch { addP2PTrack(socketId, track) }
            }

            override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) {
                val track = receiver.track() ?: return
                scope.launch { addP2PTrack(socketId, track) }
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                scope.launch { handleP2PConnectionState(socketId, newState) }
            }
        }
        val connection = checkNotNull(factory.createPeerConnection(configuration, observer)) {
            "Unable to create P2P peer connection"
        }
        val peer = P2PPeer(
            socketId = socketId,
            userId = userId,
            connection = connection,
            pendingCandidates = earlyP2PCandidates.remove(socketId) ?: mutableListOf(),
        )
        p2pPeers[socketId] = peer
        peer.timeoutJob = scope.launch {
            delay(10_000)
            if (p2pPeers[socketId]?.connected != true) closeP2PPeer(socketId, notifyServer = true)
        }
        return peer
    }

    private fun addP2PTrack(socketId: String, track: MediaStreamTrack) {
        val peer = p2pPeers[socketId] ?: return
        val mediaTag = when (track.kind().lowercase()) {
            "video" -> "screen"
            "audio" -> "screen-audio"
            else -> return
        }
        val id = "p2p:$socketId:${track.id()}"
        if (peer.tracks.containsKey(id)) return
        track.setEnabled(shouldEnableRemoteScreenTrack(mediaTag, track.kind(), screenAudioEnabled))
        peer.tracks[id] = RemoteScreenTrack(
            producerId = id,
            consumerId = id,
            userId = peer.userId,
            mediaTag = mediaTag,
            track = track,
            route = "p2p",
        )
        publish()
    }

    private fun handleP2PConnectionState(socketId: String, state: PeerConnection.PeerConnectionState) {
        val peer = p2pPeers[socketId] ?: return
        when (state) {
            PeerConnection.PeerConnectionState.CONNECTED -> {
                peer.timeoutJob?.cancel()
                peer.disconnectJob?.cancel()
                peer.connected = true
                publish()
            }
            PeerConnection.PeerConnectionState.DISCONNECTED -> {
                peer.disconnectJob?.cancel()
                peer.disconnectJob = scope.launch {
                    delay(4_000)
                    if (p2pPeers[socketId]?.connection?.connectionState() ==
                        PeerConnection.PeerConnectionState.DISCONNECTED
                    ) closeP2PPeer(socketId, notifyServer = true)
                }
            }
            PeerConnection.PeerConnectionState.FAILED,
            PeerConnection.PeerConnectionState.CLOSED,
            -> closeP2PPeer(socketId, notifyServer = state != PeerConnection.PeerConnectionState.CLOSED)
            else -> Unit
        }
    }

    private suspend fun sendP2PSignal(
        socketId: String,
        description: JSONObject? = null,
        candidate: JSONObject? = null,
    ) {
        val payload = JSONObject().put("targetSocketId", socketId)
        description?.let { payload.put("description", it) }
        candidate?.let { payload.put("candidate", it) }
        signaling.request("media:p2p:signal", payload)
    }

    private fun flushP2PCandidates(peer: P2PPeer) {
        val candidates = peer.pendingCandidates.toList()
        peer.pendingCandidates.clear()
        candidates.forEach(peer.connection::addIceCandidate)
    }

    private fun closeP2PPeer(socketId: String, notifyServer: Boolean) {
        p2pWatchRequests.remove(socketId)
        earlyP2PCandidates.remove(socketId)
        val peer = p2pPeers.remove(socketId) ?: return
        peer.timeoutJob?.cancel()
        peer.disconnectJob?.cancel()
        peer.tracks.values.forEach { it.track.setEnabled(false) }
        runCatching { peer.connection.close() }
        runCatching { peer.connection.dispose() }
        publish()
        if (notifyServer && channelId.isNotEmpty()) scope.launch {
            runCatching {
                signaling.request(
                    "media:p2p:disconnect",
                    JSONObject().put("peerSocketId", socketId),
                )
            }
        }
    }

    private fun publish() {
        if (channelId.isNotEmpty()) {
            val activeP2P = p2pPeers.values.filter { peer ->
                peer.connected && peer.tracks.values.any { it.mediaTag == "screen" }
            }
            val activeP2PUsers = activeP2P.mapTo(hashSetOf()) { it.userId }
            val visibleTracks = buildList {
                addAll(tracks.values.filterNot { it.userId in activeP2PUsers })
                activeP2P.forEach { addAll(it.tracks.values) }
            }
            mutableState.value = ScreenReceiverState.Watching(
                tracks = visibleTracks,
                quality = quality,
                screenAudioEnabled = screenAudioEnabled,
            )
        }
    }

    private suspend fun leaveLocked(notifyServer: Boolean) {
        unregisterMediaListeners()
        val hadChannel = channelId.isNotEmpty()
        // Release tracks, renderer resources and visible state before waiting
        // for a network ACK. A slow/offline media server must never keep a
        // frozen screen or delay the Mumble hang-up path.
        disposeLocal()
        if (notifyServer && hadChannel) runCatching { signaling.request("media:leave") }
    }

    private fun disposeLocal() {
        p2pPeers.keys.toList().forEach { closeP2PPeer(it, notifyServer = false) }
        p2pWatchRequests.clear()
        earlyP2PCandidates.clear()
        p2pIceServers = emptyList()
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

    private fun registerMediaListeners() {
        signaling.on("media:newProducer") { args ->
            val producer = args.firstOrNull() as? JSONObject ?: return@on
            scope.launch {
                runCatching { consume(producer) }.onFailure { error ->
                    if (channelId.isNotEmpty()) {
                        mutableState.value = ScreenReceiverState.Failed(
                            error.message ?: "无法加载新的屏幕共享",
                        )
                    }
                }
            }
        }
        signaling.on("media:producerClosed") { args ->
            val producerId = (args.firstOrNull() as? JSONObject)?.optString("producerId") ?: return@on
            scope.launch { removeProducer(producerId) }
        }
        signaling.on("media:p2p:shareStarted") { args ->
            val share = args.firstOrNull() as? JSONObject ?: return@on
            scope.launch { requestP2PWatch(share) }
        }
        signaling.on("media:p2p:shareStopped") { args ->
            val socketId = (args.firstOrNull() as? JSONObject)?.optString("socketId") ?: return@on
            scope.launch { closeP2PPeer(socketId, notifyServer = false) }
        }
        signaling.on("media:p2p:signal") { args ->
            val message = args.firstOrNull() as? JSONObject ?: return@on
            scope.launch {
                runCatching { handleP2PSignal(message) }
                    .onFailure { closeP2PPeer(message.optString("fromSocketId"), notifyServer = true) }
            }
        }
        signaling.on("media:p2p:peerDisconnected") { args ->
            val socketId = (args.firstOrNull() as? JSONObject)?.optString("socketId") ?: return@on
            scope.launch { closeP2PPeer(socketId, notifyServer = false) }
        }
        signaling.on("media:p2p:peerLeft") { args ->
            val socketId = (args.firstOrNull() as? JSONObject)?.optString("socketId") ?: return@on
            scope.launch { closeP2PPeer(socketId, notifyServer = false) }
        }
    }

    private fun unregisterMediaListeners() {
        signaling.off("media:newProducer")
        signaling.off("media:producerClosed")
        signaling.off("media:p2p:shareStarted")
        signaling.off("media:p2p:shareStopped")
        signaling.off("media:p2p:signal")
        signaling.off("media:p2p:peerDisconnected")
        signaling.off("media:p2p:peerLeft")
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

internal fun shouldEnableRemoteScreenTrack(
    mediaTag: String,
    kind: String,
    screenAudioEnabled: Boolean,
): Boolean = mediaTag != "screen-audio" || !kind.equals("audio", ignoreCase = true) || screenAudioEnabled

internal fun resolveScreenMediaTag(
    consumerMediaTag: String?,
    producerMediaTag: String?,
    kind: String,
): String = consumerMediaTag?.takeIf { it.isNotBlank() }
    ?: producerMediaTag?.takeIf { it.isNotBlank() }
    ?: kind
