package cn.poio.mobile.voice

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.Keep
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MumbleCredentials(
    val host: String,
    val port: Int,
    val username: String,
    val password: String,
    val channelName: String,
)

data class VoiceRoute(val id: Int, val name: String)

data class VoiceDeviceState(
    val inputRoutes: List<VoiceRoute> = listOf(VoiceRoute(0, "系统默认")),
    val selectedInputRouteId: Int = 0,
)

sealed interface VoiceState {
    data object Idle : VoiceState
    data object Connecting : VoiceState
    data class Connected(
        val channelName: String,
        val micLevel: Float = 0f,
        val muted: Boolean = false,
        val deafened: Boolean = false,
        val routes: List<VoiceRoute> = emptyList(),
        val selectedRouteId: Int? = null,
        val userSessions: Map<String, Int> = emptyMap(),
        val userVolumes: Map<Int, Int> = emptyMap(),
        val talkingSessions: Set<Int> = emptySet(),
        val focusSuppressed: Boolean = false,
    ) : VoiceState
    data class Failed(val message: String) : VoiceState
}

interface VoiceEngine {
    val state: StateFlow<VoiceState>
    suspend fun connect(credentials: MumbleCredentials)
    suspend fun disconnect()
    fun close()
    suspend fun setMuted(muted: Boolean)
    suspend fun setDeafened(deafened: Boolean)
    suspend fun setUserVolume(sessionId: Int, volume: Int)
    suspend fun selectRoute(routeId: Int)
}

/**
 * Thin JNI boundary around POIO's Android Mumble core. The class deliberately
 * fails closed when the ABI-specific shared library is absent; it never reports
 * a signalling-only connection as working voice.
 */
class NativeMumbleVoiceEngine(context: Context) : VoiceEngine {
    private val appContext = context.applicationContext
    private val engineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lifecycleLock = Any()
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val audioFocusListener = AudioManager.OnAudioFocusChangeListener(::onAudioFocusChanged)
    private val voicePreferences = appContext.getSharedPreferences("voice_settings", Context.MODE_PRIVATE)
    private var audioFocusRequest: AudioFocusRequest? = null
    private var previousAudioMode = AudioManager.MODE_NORMAL
    private val audioDeviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            refreshRouteState()
            refreshInputDeviceState()
        }
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
            refreshRouteState()
            refreshInputDeviceState()
        }
    }
    private val mutableState = MutableStateFlow<VoiceState>(VoiceState.Idle)
    override val state: StateFlow<VoiceState> = mutableState.asStateFlow()
    private val mutableDeviceState = MutableStateFlow(VoiceDeviceState())
    val deviceState: StateFlow<VoiceDeviceState> = mutableDeviceState.asStateFlow()
    @Volatile
    private var handle = 0L
    @Volatile
    private var desiredCredentials: MumbleCredentials? = null
    @Volatile
    private var connectionGeneration = 0L
    @Volatile
    private var disposed = false
    @Volatile
    private var foregroundServiceActive = false
    private var reconnectJob: Job? = null
    private var desiredMuted = false
    private var desiredDeafened = false
    @Volatile
    private var preferredInputDeviceId = voicePreferences.getInt(PREFERRED_INPUT_DEVICE_KEY, 0)
    @Volatile
    private var focusSuppressed = false

    init {
        audioManager.registerAudioDeviceCallback(audioDeviceCallback, Handler(Looper.getMainLooper()))
        refreshInputDeviceState()
    }

    override suspend fun connect(credentials: MumbleCredentials) = withContext(Dispatchers.IO) {
        disconnectInternal(publishIdle = false)
        check(!disposed) { "语音引擎已经释放" }
        val generation = synchronized(lifecycleLock) {
            connectionGeneration += 1
            desiredCredentials = credentials
            connectionGeneration
        }
        mutableState.value = VoiceState.Connecting
        runCatching {
            connectOnce(credentials, generation)
        }.onFailure { error ->
            if (error is CancellationException || connectionGeneration != generation) return@onFailure
            synchronized(lifecycleLock) {
                if (connectionGeneration == generation) desiredCredentials = null
            }
            val failedHandle = takeHandle(generation)
            if (failedHandle != 0L && NativeBridge.available) {
                runCatching { NativeBridge.disconnect(failedHandle) }
            }
            VoiceForegroundService.stop(appContext)
            foregroundServiceActive = false
            releaseAudioRoute()
            mutableState.value = VoiceState.Failed(error.message ?: "Mumble 原生核心启动失败")
            throw error
        }
        Unit
    }

    override suspend fun disconnect() = withContext(Dispatchers.IO) { close() }

    override fun close() {
        disconnectInternal(publishIdle = true)
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        close()
        audioManager.unregisterAudioDeviceCallback(audioDeviceCallback)
        engineScope.cancel()
    }

    private fun disconnectInternal(publishIdle: Boolean) {
        val previousHandle: Long
        val pendingReconnect: Job?
        synchronized(lifecycleLock) {
            connectionGeneration += 1
            desiredCredentials = null
            previousHandle = handle
            handle = 0L
            pendingReconnect = reconnectJob
            reconnectJob = null
        }
        pendingReconnect?.cancel()
        if (previousHandle != 0L && NativeBridge.available) {
            runCatching { NativeBridge.disconnect(previousHandle) }
        }
        VoiceForegroundService.stop(appContext)
        foregroundServiceActive = false
        releaseAudioRoute()
        if (publishIdle) mutableState.value = VoiceState.Idle
    }

    override suspend fun setMuted(muted: Boolean) = updateConnected { current ->
        desiredMuted = muted
        val effective = effectiveVoiceControls(desiredMuted, desiredDeafened, focusSuppressed)
        NativeBridge.setMuted(handle, effective.muted)
        current.copy(
            muted = effective.muted,
            deafened = effective.deafened,
            focusSuppressed = focusSuppressed,
        )
    }

    override suspend fun setDeafened(deafened: Boolean) = updateConnected { current ->
        desiredDeafened = deafened
        if (deafened) desiredMuted = true
        val effective = effectiveVoiceControls(desiredMuted, desiredDeafened, focusSuppressed)
        NativeBridge.setDeafened(handle, effective.deafened)
        NativeBridge.setMuted(handle, effective.muted)
        current.copy(
            deafened = effective.deafened,
            muted = effective.muted,
            focusSuppressed = focusSuppressed,
        )
    }

    override suspend fun setUserVolume(sessionId: Int, volume: Int) = withContext(Dispatchers.IO) {
        checkConnected()
        val normalized = volume.coerceIn(NativeMumbleContract.MIN_USER_VOLUME, NativeMumbleContract.MAX_USER_VOLUME)
        NativeBridge.setUserVolume(handle, sessionId, normalized)
        mutableState.update { current ->
            if (current is VoiceState.Connected) {
                current.copy(userVolumes = current.userVolumes + (sessionId to normalized))
            } else {
                current
            }
        }
    }

    override suspend fun selectRoute(routeId: Int) = withContext(Dispatchers.IO) {
        checkConnected()
        val changed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val route = runCatching { audioManager.availableCommunicationDevices.firstOrNull { it.id == routeId } }.getOrNull()
            route != null && runCatching { audioManager.setCommunicationDevice(route) }.getOrDefault(false)
        } else {
            @Suppress("DEPRECATION")
            when (routeId) {
                ROUTE_SPEAKER -> { audioManager.isSpeakerphoneOn = true; true }
                ROUTE_EARPIECE -> { audioManager.isSpeakerphoneOn = false; true }
                else -> false
            }
        }
        check(changed) { "无法切换到所选音频设备" }
        refreshRouteState()
    }

    suspend fun selectInputRoute(routeId: Int) = withContext(Dispatchers.IO) {
        check(mutableState.value !is VoiceState.Connecting && mutableState.value !is VoiceState.Connected) {
            "请先挂断语音，再切换输入设备"
        }
        val available = inputRouteSnapshot().any { it.id == routeId }
        check(available) { "所选输入设备已经断开" }
        preferredInputDeviceId = routeId
        voicePreferences.edit().putInt(PREFERRED_INPUT_DEVICE_KEY, routeId).apply()
        refreshInputDeviceState()
    }

    @Keep
    @Suppress("unused")
    private fun onNativeMicLevel(level: Float) {
        mutableState.update { current ->
            if (current is VoiceState.Connected) {
                current.copy(micLevel = level.coerceIn(0f, 1f))
            } else {
                current
            }
        }
    }

    @Keep
    @Suppress("unused")
    private fun onNativeFailure(message: String) {
        // This callback runs on a libmumble worker. Deleting the native session
        // here would make it join its own thread, so cleanup and retry are
        // scheduled on the engine IO scope after the callback returns.
        synchronized(lifecycleLock) {
            val credentials = desiredCredentials ?: return
            val generation = connectionGeneration
            if (disposed) return
            if (reconnectJob?.isActive == true) return
            mutableState.value = VoiceState.Failed(message)
            reconnectJob = engineScope.launch { reconnectLoop(credentials, generation, message) }
        }
    }

    @Keep
    @Suppress("unused")
    private fun onNativeUserSession(sessionId: Int, username: String, present: Boolean) {
        mutableState.update { current ->
            if (current !is VoiceState.Connected) return@update current
            val sessions = if (present && username.isNotBlank()) {
                current.userSessions + (username to sessionId)
            } else {
                current.userSessions.filterValues { it != sessionId }
            }
            current.copy(
                userSessions = sessions,
                userVolumes = if (present) current.userVolumes else current.userVolumes - sessionId,
                talkingSessions = if (present) {
                    current.talkingSessions
                } else {
                    updatedTalkingSessions(current.talkingSessions, sessionId, talking = false)
                },
            )
        }
    }

    @Keep
    @Suppress("unused")
    private fun onNativeUserTalking(sessionId: Int, talking: Boolean) {
        mutableState.update { current ->
            if (current is VoiceState.Connected) {
                current.copy(
                    talkingSessions = updatedTalkingSessions(current.talkingSessions, sessionId, talking),
                )
            } else {
                current
            }
        }
    }

    @Synchronized
    private fun prepareAudioRoute() {
        if (audioFocusRequest != null) return
        previousAudioMode = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener(audioFocusListener)
            .build()
        val focusResult = audioManager.requestAudioFocus(request)
        if (focusResult != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            audioManager.mode = previousAudioMode
            error("其他应用正在占用通话音频，请稍后重试")
        }
        focusSuppressed = false
        audioFocusRequest = request
    }

    @Synchronized
    private fun releaseAudioRoute() {
        audioFocusRequest?.let(audioManager::abandonAudioFocusRequest)
        audioFocusRequest = null
        focusSuppressed = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { audioManager.clearCommunicationDevice() }
        }
        if (audioManager.mode == AudioManager.MODE_IN_COMMUNICATION) {
            audioManager.mode = previousAudioMode
        }
    }

    private fun refreshRouteState() {
        val current = mutableState.value as? VoiceState.Connected ?: return
        val (routes, selectedRouteId) = routeSnapshot()
        mutableState.value = current.copy(routes = routes, selectedRouteId = selectedRouteId)
    }

    private fun refreshInputDeviceState() {
        val routes = inputRouteSnapshot()
        val selected = preferredInputDeviceId.takeIf { id -> routes.any { it.id == id } } ?: 0
        if (selected != preferredInputDeviceId) {
            preferredInputDeviceId = selected
            voicePreferences.edit().putInt(PREFERRED_INPUT_DEVICE_KEY, selected).apply()
        }
        mutableDeviceState.value = VoiceDeviceState(routes, selected)
    }

    private fun onAudioFocusChanged(change: Int) {
        val suppressed = when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> false
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
            -> true
            else -> return
        }
        if (focusSuppressed == suppressed) return
        focusSuppressed = suppressed
        engineScope.launch { applyEffectiveVoiceControls() }
    }

    private fun applyEffectiveVoiceControls() {
        val currentHandle = synchronized(lifecycleLock) { handle }
        if (mutableState.value !is VoiceState.Connected) return
        if (currentHandle == 0L || !NativeBridge.available) return
        val effective = effectiveVoiceControls(desiredMuted, desiredDeafened, focusSuppressed)
        runCatching {
            // Apply deafen first, then the exact mute preference. Native
            // self-deafen forces mute, so the order matters when focus returns.
            NativeBridge.setDeafened(currentHandle, effective.deafened)
            NativeBridge.setMuted(currentHandle, effective.muted)
        }.onSuccess {
            val latest = mutableState.value as? VoiceState.Connected ?: return@onSuccess
            mutableState.value = latest.copy(
                muted = effective.muted,
                deafened = effective.deafened,
                focusSuppressed = focusSuppressed,
            )
        }
    }

    private fun routeSnapshot(): Pair<List<VoiceRoute>, Int?> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return runCatching {
                val devices = audioManager.availableCommunicationDevices
                devices.map { VoiceRoute(it.id, routeName(it)) } to audioManager.communicationDevice?.id
            }.getOrElse { emptyList<VoiceRoute>() to null }
        }
        @Suppress("DEPRECATION")
        return listOf(
            VoiceRoute(ROUTE_EARPIECE, "听筒"),
            VoiceRoute(ROUTE_SPEAKER, "扬声器"),
        ) to if (audioManager.isSpeakerphoneOn) ROUTE_SPEAKER else ROUTE_EARPIECE
    }

    private fun inputRouteSnapshot(): List<VoiceRoute> {
        val devices = runCatching { audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS) }.getOrDefault(emptyArray())
        return normalizedInputRoutes(
            candidates = devices
                .distinctBy(AudioDeviceInfo::getId)
                // TYPE_TELEPHONY is a virtual call endpoint rather than a
                // selectable physical microphone for our AAudio capture stream.
                .filterNot { it.type == AudioDeviceInfo.TYPE_TELEPHONY }
                .map(::inputDeviceCandidate),
            preferredId = preferredInputDeviceId,
        )
    }

    private fun inputDeviceCandidate(device: AudioDeviceInfo): InputDeviceCandidate {
        val product = device.productName?.toString()?.trim().orEmpty()
        val (family, fallback) = when (device.type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin" to "内置麦克风"
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired" to "有线耳麦"
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth" to "蓝牙耳麦"
            AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "usb" to "USB 麦克风"
            AudioDeviceInfo.TYPE_TELEPHONY -> "telephony" to "通话麦克风"
            AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth-le" to "蓝牙 LE 麦克风"
            else -> "type-${device.type}" to "外部麦克风"
        }
        val external = family != "builtin" && family != "telephony"
        val label = if (external && product.isNotBlank() && !product.equals(Build.MODEL, ignoreCase = true)) {
            "$fallback · $product"
        } else {
            fallback
        }
        val groupKey = inputDeviceGroupKey(family, fallback, product, Build.MODEL)
        return InputDeviceCandidate(device.id, groupKey, label)
    }

    private fun routeName(device: AudioDeviceInfo): String {
        val fallback = when (device.type) {
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "听筒"
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "扬声器"
            AudioDeviceInfo.TYPE_BUILTIN_MIC -> "内置麦克风"
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "有线耳麦"
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "有线耳机"
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "蓝牙耳机"
            AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "USB 音频设备"
            AudioDeviceInfo.TYPE_HEARING_AID -> "助听设备"
            AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER -> "蓝牙 LE 音频"
            else -> "音频设备"
        }
        return device.productName?.toString()?.takeIf(String::isNotBlank) ?: fallback
    }

    private suspend fun updateConnected(block: (VoiceState.Connected) -> VoiceState.Connected) = withContext(Dispatchers.IO) {
        checkConnected()
        mutableState.value = block(mutableState.value as VoiceState.Connected)
    }

    private fun checkConnected() {
        check(handle != 0L && NativeBridge.available && mutableState.value is VoiceState.Connected) { "尚未连接语音频道" }
    }

    private fun connectOnce(credentials: MumbleCredentials, generation: Long) {
        check(NativeBridge.available) { "当前 APK 尚未包含 Mumble Android 原生库" }
        prepareAudioRoute()
        val connectedHandle = NativeBridge.connect(
            credentials.host,
            credentials.port,
            credentials.username,
            credentials.password,
            credentials.channelName,
            preferredInputDeviceId,
            this@NativeMumbleVoiceEngine,
        )
        check(connectedHandle != 0L) { "Mumble 原生核心连接失败" }
        val accepted = synchronized(lifecycleLock) {
            if (disposed || connectionGeneration != generation || desiredCredentials != credentials) {
                false
            } else {
                handle = connectedHandle
                true
            }
        }
        if (!accepted) {
            NativeBridge.disconnect(connectedHandle)
            throw CancellationException("语音连接已取消")
        }
        val effective = effectiveVoiceControls(desiredMuted, desiredDeafened, focusSuppressed)
        NativeBridge.setDeafened(connectedHandle, effective.deafened)
        NativeBridge.setMuted(connectedHandle, effective.muted)
        if (!foregroundServiceActive) {
            VoiceForegroundService.start(appContext, credentials.channelName)
            foregroundServiceActive = true
        }
        val (routes, selectedRouteId) = routeSnapshot()
        mutableState.value = VoiceState.Connected(
            channelName = credentials.channelName,
            muted = effective.muted,
            deafened = effective.deafened,
            focusSuppressed = focusSuppressed,
            routes = routes,
            selectedRouteId = selectedRouteId,
        )
        NativeBridge.requestUserSessions(connectedHandle)
    }

    private suspend fun reconnectLoop(credentials: MumbleCredentials, generation: Long, originalMessage: String) {
        var delayMillis = 1_000L
        var attempt = 0
        while (engineScope.isActive && !disposed && desiredCredentials == credentials && connectionGeneration == generation) {
            delay(delayMillis)
            if (desiredCredentials != credentials || connectionGeneration != generation) return
            val previousHandle = takeHandle(generation)
            if (previousHandle != 0L && NativeBridge.available) {
                runCatching { NativeBridge.disconnect(previousHandle) }
            }
            if (desiredCredentials != credentials || connectionGeneration != generation) return
            attempt += 1
            mutableState.value = VoiceState.Connecting
            val result = runCatching { connectOnce(credentials, generation) }
            if (result.isSuccess) return
            val error = result.exceptionOrNull()
            if (error is CancellationException) return
            mutableState.value = VoiceState.Failed(
                "语音连接中断，自动重连第 ${attempt} 次失败：${error?.message ?: originalMessage}",
            )
            delayMillis = (delayMillis * 2).coerceAtMost(15_000L)
        }
    }

    private fun takeHandle(generation: Long): Long = synchronized(lifecycleLock) {
        if (connectionGeneration != generation) return@synchronized 0L
        val previous = handle
        handle = 0L
        previous
    }

    private object NativeBridge {
        val available = runCatching { System.loadLibrary("poio_mumble") }.isSuccess
        external fun coreVersion(): String
        external fun connect(
            host: String,
            port: Int,
            username: String,
            password: String,
            channelName: String,
            inputDeviceId: Int,
            callback: NativeMumbleVoiceEngine,
        ): Long
        external fun disconnect(handle: Long)
        external fun setMuted(handle: Long, muted: Boolean)
        external fun setDeafened(handle: Long, deafened: Boolean)
        external fun setUserVolume(handle: Long, sessionId: Int, volume: Int)
        external fun requestUserSessions(handle: Long)
    }

    private companion object {
        const val PREFERRED_INPUT_DEVICE_KEY = "preferred_input_device_id"
        const val ROUTE_EARPIECE = -1
        const val ROUTE_SPEAKER = -2
    }
}

/**
 * JNI contract for the upcoming NDK module. Keeping it behind this interface lets
 * the Compose and Socket.IO layers compile and be tested before native audio lands.
 */
internal object NativeMumbleContract {
    const val SAMPLE_RATE = 48_000
    const val CHANNELS = 1
    const val MIN_USER_VOLUME = 0
    const val MAX_USER_VOLUME = 200
}

internal fun updatedTalkingSessions(current: Set<Int>, sessionId: Int, talking: Boolean): Set<Int> =
    if (talking) current + sessionId else current - sessionId
