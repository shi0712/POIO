package cn.poio.mobile

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cn.poio.mobile.screen.MediasoupScreenReceiver
import cn.poio.mobile.screen.ScreenReceiverState
import cn.poio.mobile.screen.ScreenQuality
import cn.poio.mobile.screen.screenReceiverChannel
import cn.poio.mobile.screen.screenReconnectDelayMillis
import cn.poio.mobile.voice.MicrophoneTester
import cn.poio.mobile.voice.MicrophoneTestState
import cn.poio.mobile.voice.VoiceDeviceState
import cn.poio.mobile.voice.VoiceState
import cn.poio.mobile.voice.leaveVoiceSafely
import cn.poio.mobile.model.User
import cn.poio.mobile.update.AndroidUpdateInfo
import cn.poio.mobile.update.AndroidUpdateManager
import cn.poio.mobile.update.AndroidUpdateState
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class PoioViewModel(application: Application) : AndroidViewModel(application), PoioActions {
    private val poioApplication = application as PoioApplication
    private val repository = poioApplication.repository
    private val voiceEngine = poioApplication.voiceEngine
    private val voiceCuePlayer = poioApplication.voiceCuePlayer
    private val microphoneTester = MicrophoneTester(application)
    private val screenReceiver = MediasoupScreenReceiver(application, repository.client)
    private val updateManager = AndroidUpdateManager(application, viewModelScope)
    val state = repository.state
    val voiceState: StateFlow<VoiceState> = voiceEngine.state
    val voiceDeviceState: StateFlow<VoiceDeviceState> = voiceEngine.deviceState
    val microphoneTestState: StateFlow<MicrophoneTestState> = microphoneTester.state
    val screenState: StateFlow<ScreenReceiverState> = screenReceiver.state
    val updateState: StateFlow<AndroidUpdateState> = updateManager.state
    private var recoveryJob: Job? = null
    private var screenRecoveryJob: Job? = null
    private var screenRecoveryAttempt = 0

    init {
        updateManager.start()
        viewModelScope.launch {
            var observedGeneration = 0L
            state.collect { current ->
                if (!current.authenticated) {
                    observedGeneration = 0L
                    return@collect
                }
                val generation = current.authenticatedConnectionGeneration
                if (generation <= observedGeneration) return@collect
                val reconnecting = observedGeneration > 0
                observedGeneration = generation
                if (reconnecting) {
                    recoveryJob?.cancel()
                    recoveryJob = viewModelScope.launch { recoverScreenAfterSocketReconnect() }
                }
            }
        }
        viewModelScope.launch {
            var initialized = false
            var observedTarget: String? = null
            state.collect { current ->
                val target = screenReceiverChannel(current.selectedChannel, current.voiceChannelId)
                if (initialized && target == observedTarget) return@collect
                initialized = true
                observedTarget = target
                runCatching {
                    if (target != null) screenReceiver.join(target) else screenReceiver.leave()
                }.onFailure(repository::reportError)
            }
        }
        viewModelScope.launch {
            screenState.collect { current ->
                when (current) {
                    is ScreenReceiverState.Failed -> scheduleScreenRecovery()
                    is ScreenReceiverState.Watching -> if (current.tracks.isNotEmpty()) {
                        screenRecoveryAttempt = 0
                        screenRecoveryJob?.cancel()
                        screenRecoveryJob = null
                    }
                    ScreenReceiverState.Idle -> {
                        if (screenReceiverChannel(state.value.selectedChannel, state.value.voiceChannelId) == null) {
                            screenRecoveryAttempt = 0
                            screenRecoveryJob?.cancel()
                            screenRecoveryJob = null
                        }
                    }
                    ScreenReceiverState.Connecting -> Unit
                }
            }
        }
    }

    override fun authenticate(username: String, password: String, register: Boolean) {
        viewModelScope.launch { repository.login(username, password, register) }
    }

    override fun logout() { viewModelScope.launch { leaveVoiceInternal(); repository.logout() } }
    override fun selectSpace(id: String) {
        viewModelScope.launch { repository.selectSpace(id) }
    }
    override fun selectChannel(id: String) {
        viewModelScope.launch { repository.selectChannel(id) }
    }
    override fun sendMessage(body: String, replyToId: String?) { viewModelScope.launch { repository.sendMessage(body, replyToId) } }
    override fun sendAttachment(uri: Uri, body: String, replyToId: String?) { viewModelScope.launch { repository.sendAttachment(uri, body, replyToId) } }
    override fun editMessage(messageId: String, body: String) { viewModelScope.launch { repository.editMessage(messageId, body) } }
    override fun deleteMessage(messageId: String) { viewModelScope.launch { repository.deleteMessage(messageId) } }
    override fun reactMessage(messageId: String, emoji: String) { viewModelScope.launch { repository.reactMessage(messageId, emoji) } }
    override fun searchMessages(query: String) { viewModelScope.launch { repository.searchMessages(query) } }
    override fun clearMessageSearch() = repository.clearMessageSearch()
    override fun openDirectMessage(user: User) { viewModelScope.launch { repository.openDirectMessage(user) } }
    override fun closeDirectMessage() = repository.closeDirectMessage()
    override fun sendDirectMessage(body: String) { viewModelScope.launch { repository.sendDirectMessage(body) } }
    override fun sendDirectAttachment(uri: Uri, body: String) { viewModelScope.launch { repository.sendDirectAttachment(uri, body) } }
    override fun updateAvatar(uri: Uri) { viewModelScope.launch { repository.updateAvatar(uri) } }
    override fun updateLeaveSound(uri: Uri?) {
        viewModelScope.launch {
            repository.updateLeaveSound(uri)
            voiceCuePlayer.playLeave(state.value.user?.leaveSoundUrl)
        }
    }
    override fun testLeaveSound() = voiceCuePlayer.playLeave(state.value.user?.leaveSoundUrl)
    override fun createSpace(name: String) { viewModelScope.launch { repository.createSpace(name) } }
    override fun joinSpace(code: String) { viewModelScope.launch { repository.joinSpace(code) } }
    override fun createSpaceInvite() { viewModelScope.launch { repository.createSpaceInvite() } }
    override fun clearSpaceInvite() = repository.clearSpaceInvite()
    override fun createChannel(name: String, voice: Boolean) { viewModelScope.launch { repository.createChannel(name, voice) } }
    override fun joinVoice(channelId: String) {
        viewModelScope.launch {
            runCatching {
                if (state.value.voiceChannelId != null) leaveVoiceInternal()
                val credentials = repository.voiceCredentials(channelId)
                voiceEngine.connect(credentials)
                repository.announceVoiceJoin(channelId)
                voiceCuePlayer.playJoin(state.value.user?.joinSoundUrl)
            }.onFailure { error ->
                runCatching { screenReceiver.leave() }
                runCatching { voiceEngine.disconnect() }
                repository.reportError(error)
            }
        }
    }
    override fun leaveVoice() { viewModelScope.launch { leaveVoiceInternal() } }
    override fun setMuted(muted: Boolean) {
        viewModelScope.launch {
            runVoiceAction {
                val before = voiceState.value as? VoiceState.Connected
                voiceEngine.setMuted(muted)
                val after = voiceState.value as? VoiceState.Connected
                if (after != null && before?.muted != after.muted) {
                    if (after.muted) voiceCuePlayer.playMute() else voiceCuePlayer.playUnmute()
                }
            }
        }
    }
    override fun setDeafened(deafened: Boolean) {
        viewModelScope.launch {
            runVoiceAction {
                val before = voiceState.value as? VoiceState.Connected
                voiceEngine.setDeafened(deafened)
                val after = voiceState.value as? VoiceState.Connected
                if (after != null && before?.deafened != after.deafened) {
                    if (after.deafened) voiceCuePlayer.playDeafen() else voiceCuePlayer.playUndeafen()
                }
            }
        }
    }
    override fun selectVoiceRoute(routeId: Int) { viewModelScope.launch { runVoiceAction { voiceEngine.selectRoute(routeId) } } }
    override fun setUserVolume(sessionId: Int, volume: Int) { viewModelScope.launch { runVoiceAction { voiceEngine.setUserVolume(sessionId, volume) } } }
    override fun selectInputRoute(routeId: Int) {
        microphoneTester.stop()
        viewModelScope.launch {
            runCatching { voiceEngine.selectInputRoute(routeId) }.onFailure(repository::reportError)
        }
    }
    override fun startMicrophoneTest() {
        if (
            voiceState.value is VoiceState.Connecting ||
            voiceState.value is VoiceState.Reconnecting ||
            voiceState.value is VoiceState.Connected
        ) {
            repository.reportError(IllegalStateException("请先挂断语音，再测试麦克风"))
            return
        }
        val devices = voiceDeviceState.value
        val selected = devices.inputRoutes.firstOrNull { it.id == devices.selectedInputRouteId }
            ?: devices.inputRoutes.first()
        microphoneTester.start(selected.id, selected.name)
    }
    override fun stopMicrophoneTest() = microphoneTester.stop()
    override fun setScreenQuality(quality: ScreenQuality) {
        viewModelScope.launch { runCatching { screenReceiver.setQuality(quality) }.onFailure(repository::reportError) }
    }
    override fun setScreenAudioEnabled(enabled: Boolean) {
        viewModelScope.launch {
            runCatching { screenReceiver.setScreenAudioEnabled(enabled) }.onFailure(repository::reportError)
        }
    }
    override fun retryScreenReceiver() {
        screenRecoveryJob?.cancel()
        screenRecoveryJob = null
        screenRecoveryAttempt = 0
        viewModelScope.launch {
            restartScreenReceiver(reportError = true)
        }
    }
    override fun showError(message: String) = repository.reportError(IllegalStateException(message))
    override fun checkForUpdates() = updateManager.checkForUpdates()
    override fun downloadUpdate(info: AndroidUpdateInfo) = updateManager.download(info)
    override fun installReadyUpdate() = updateManager.installReadyUpdate()
    override fun clearError() = repository.clearError()

    override fun onCleared() {
        recoveryJob?.cancel()
        screenRecoveryJob?.cancel()
        microphoneTester.close()
        screenReceiver.close()
        updateManager.close()
        super.onCleared()
    }

    private suspend fun leaveVoiceInternal() {
        val hadVoice = state.value.voiceChannelId != null
        val leaveSoundUrl = state.value.user?.leaveSoundUrl
        screenRecoveryJob?.cancel()
        screenRecoveryJob = null
        screenRecoveryAttempt = 0
        leaveVoiceSafely(
            onLocalLeave = repository::markVoiceLeftLocally,
            disconnectVoice = voiceEngine::disconnect,
            announceRemoteLeave = repository::announceVoiceLeave,
            leaveScreen = screenReceiver::leave,
        )
        if (hadVoice) voiceCuePlayer.playLeave(leaveSoundUrl)
    }

    private suspend fun runVoiceAction(action: suspend () -> Unit) {
        runCatching { action() }.onFailure(repository::reportError)
    }

    private fun scheduleScreenRecovery() {
        if (screenRecoveryJob?.isActive == true) return
        val targetChannelId = screenReceiverChannel(state.value.selectedChannel, state.value.voiceChannelId) ?: return
        val delayMillis = screenReconnectDelayMillis(screenRecoveryAttempt++)
        screenRecoveryJob = viewModelScope.launch {
            delay(delayMillis)
            screenRecoveryJob = null
            if (
                screenReceiverChannel(state.value.selectedChannel, state.value.voiceChannelId) == targetChannelId &&
                screenState.value is ScreenReceiverState.Failed
            ) {
                restartScreenReceiver(reportError = false)
            }
        }
    }

    private suspend fun restartScreenReceiver(reportError: Boolean) {
        val result = runCatching {
            screenReceiver.leave()
            val targetChannelId = screenReceiverChannel(state.value.selectedChannel, state.value.voiceChannelId)
                ?: return@runCatching
            screenReceiver.join(targetChannelId)
        }
        if (reportError) result.onFailure(repository::reportError)
    }

    private suspend fun recoverScreenAfterSocketReconnect() {
        val selectedChannel = state.value.selectedChannel
        val targetChannelId = screenReceiverChannel(selectedChannel, state.value.voiceChannelId)
        if (targetChannelId != null) {
            runCatching {
                // A mediasoup peer is keyed by the old Socket.IO id and is
                // discarded server-side on disconnect, even if WebRTC has not
                // emitted "closed" yet. Force a fresh media session.
                screenReceiver.leave()
                screenReceiver.join(targetChannelId)
            }.onFailure(repository::reportError)
        }
    }
}

interface PoioActions {
    fun authenticate(username: String, password: String, register: Boolean)
    fun logout()
    fun selectSpace(id: String)
    fun selectChannel(id: String)
    fun sendMessage(body: String, replyToId: String? = null)
    fun sendAttachment(uri: Uri, body: String, replyToId: String? = null)
    fun editMessage(messageId: String, body: String)
    fun deleteMessage(messageId: String)
    fun reactMessage(messageId: String, emoji: String)
    fun searchMessages(query: String)
    fun clearMessageSearch()
    fun openDirectMessage(user: User)
    fun closeDirectMessage()
    fun sendDirectMessage(body: String)
    fun sendDirectAttachment(uri: Uri, body: String)
    fun updateAvatar(uri: Uri)
    fun updateLeaveSound(uri: Uri?)
    fun testLeaveSound()
    fun createSpace(name: String)
    fun joinSpace(code: String)
    fun createSpaceInvite()
    fun clearSpaceInvite()
    fun createChannel(name: String, voice: Boolean)
    fun joinVoice(channelId: String)
    fun leaveVoice()
    fun setMuted(muted: Boolean)
    fun setDeafened(deafened: Boolean)
    fun selectVoiceRoute(routeId: Int)
    fun setUserVolume(sessionId: Int, volume: Int)
    fun selectInputRoute(routeId: Int)
    fun startMicrophoneTest()
    fun stopMicrophoneTest()
    fun setScreenQuality(quality: ScreenQuality)
    fun setScreenAudioEnabled(enabled: Boolean)
    fun retryScreenReceiver()
    fun showError(message: String)
    fun checkForUpdates()
    fun downloadUpdate(info: AndroidUpdateInfo)
    fun installReadyUpdate()
    fun clearError()
}
