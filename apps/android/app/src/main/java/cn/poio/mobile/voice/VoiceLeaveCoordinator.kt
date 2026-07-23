package cn.poio.mobile.voice

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope

/**
 * The local room state and native Mumble session are always torn down before
 * best-effort network/media cleanup. This prevents a slow Socket.IO request
 * from leaving capture and playback active after the user taps hang up.
 */
internal suspend fun leaveVoiceSafely(
    onLocalLeave: () -> Unit,
    disconnectVoice: suspend () -> Unit,
    announceRemoteLeave: suspend () -> Unit,
    leaveScreen: suspend () -> Unit,
) {
    onLocalLeave()
    bestEffortVoiceCleanup(disconnectVoice)
    supervisorScope {
        launch { bestEffortVoiceCleanup(announceRemoteLeave) }
        launch { bestEffortVoiceCleanup(leaveScreen) }
    }
}

private suspend fun bestEffortVoiceCleanup(action: suspend () -> Unit) {
    try {
        action()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Throwable) {
        // Local hang-up already succeeded. Server presence will also be
        // reconciled when the socket reconnects or disconnects.
    }
}
