package cn.poio.mobile

import android.app.Application
import cn.poio.mobile.data.PoioRepository
import cn.poio.mobile.data.VoicePresenceCue
import cn.poio.mobile.session.SecureSessionStore
import cn.poio.mobile.voice.NativeMumbleVoiceEngine
import cn.poio.mobile.voice.VoiceState
import cn.poio.mobile.voice.VoiceCuePlayer
import cn.poio.mobile.voice.nextNotificationMuteState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PoioApplication : Application() {
    private val runtimeScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var repository: PoioRepository
        private set
    lateinit var voiceEngine: NativeMumbleVoiceEngine
        private set
    lateinit var voiceCuePlayer: VoiceCuePlayer
        private set

    override fun onCreate() {
        super.onCreate()
        repository = PoioRepository(runtimeScope, SecureSessionStore(this), contentResolver)
        voiceEngine = NativeMumbleVoiceEngine(this)
        voiceCuePlayer = VoiceCuePlayer(this)
        repository.start()
        runtimeScope.launch {
            repository.voicePresenceCues.collect { cue ->
                val current = repository.state.value
                if (!shouldPlayVoicePresenceCue(
                        activeChannelId = current.voiceChannelId,
                        currentUserId = current.user?.id,
                        eventChannelId = cue.channelId,
                        eventUserId = cue.user.id,
                    )
                ) return@collect
                when (cue) {
                    is VoicePresenceCue.Joined -> voiceCuePlayer.playJoin(cue.user.joinSoundUrl)
                    is VoicePresenceCue.Left -> voiceCuePlayer.playLeave(cue.user.leaveSoundUrl)
                }
            }
        }
        runtimeScope.launch {
            var observedGeneration = 0L
            repository.state.collect { current ->
                if (!current.authenticated) {
                    observedGeneration = 0L
                    return@collect
                }
                val generation = current.authenticatedConnectionGeneration
                if (generation <= observedGeneration) return@collect
                val reconnected = observedGeneration > 0
                observedGeneration = generation
                val activeChannelId = current.voiceChannelId
                if (reconnected && activeChannelId != null) {
                    runCatching {
                        if (voiceEngine.state.value !is VoiceState.Connected) {
                            // Asking for fresh credentials also atomically
                            // claims this account's Mumble username server-side,
                            // releasing any ghost session before the native
                            // reconnect loop makes its next attempt.
                            repository.voiceCredentials(activeChannelId)
                        }
                        repository.announceVoiceJoin(activeChannelId)
                    }
                        .onFailure(repository::reportError)
                }
            }
        }
    }

    fun toggleMuteFromNotification() {
        val target = nextNotificationMuteState(voiceEngine.state.value) ?: return
        runtimeScope.launch {
            runCatching {
                val before = voiceEngine.state.value as? VoiceState.Connected
                voiceEngine.setMuted(target)
                val after = voiceEngine.state.value as? VoiceState.Connected
                if (after != null && before?.muted != after.muted) {
                    if (after.muted) voiceCuePlayer.playMute() else voiceCuePlayer.playUnmute()
                }
            }.onFailure(repository::reportError)
        }
    }

    fun leaveVoiceFromNotification() {
        val hadVoice = repository.state.value.voiceChannelId != null
        val leaveSoundUrl = repository.state.value.user?.leaveSoundUrl
        repository.markVoiceLeftLocally()
        runtimeScope.launch {
            runCatching { voiceEngine.disconnect() }
            runCatching { repository.announceVoiceLeave() }
            if (hadVoice) voiceCuePlayer.playLeave(leaveSoundUrl)
        }
    }
}

internal fun shouldPlayVoicePresenceCue(
    activeChannelId: String?,
    currentUserId: String?,
    eventChannelId: String,
    eventUserId: String,
): Boolean = activeChannelId != null &&
    activeChannelId == eventChannelId &&
    currentUserId != eventUserId
