package cn.poio.mobile

import android.app.Application
import cn.poio.mobile.data.PoioRepository
import cn.poio.mobile.session.SecureSessionStore
import cn.poio.mobile.voice.NativeMumbleVoiceEngine
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

    override fun onCreate() {
        super.onCreate()
        repository = PoioRepository(runtimeScope, SecureSessionStore(this), contentResolver)
        voiceEngine = NativeMumbleVoiceEngine(this)
        repository.start()
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
                    runCatching { repository.announceVoiceJoin(activeChannelId) }
                        .onFailure(repository::reportError)
                }
            }
        }
    }

    fun toggleMuteFromNotification() {
        val target = nextNotificationMuteState(voiceEngine.state.value) ?: return
        runtimeScope.launch {
            runCatching { voiceEngine.setMuted(target) }.onFailure(repository::reportError)
        }
    }

    fun leaveVoiceFromNotification() {
        repository.markVoiceLeftLocally()
        runtimeScope.launch {
            runCatching { voiceEngine.disconnect() }
            runCatching { repository.announceVoiceLeave() }
        }
    }
}
