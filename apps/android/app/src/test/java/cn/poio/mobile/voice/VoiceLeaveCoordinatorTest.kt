package cn.poio.mobile.voice

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

class VoiceLeaveCoordinatorTest {
    @Test
    fun disconnectsNativeVoiceBeforeWaitingForRemoteCleanup() = runBlocking {
        val events = Collections.synchronizedList(mutableListOf<String>())

        leaveVoiceSafely(
            onLocalLeave = { events += "local" },
            disconnectVoice = { events += "mumble" },
            announceRemoteLeave = { events += "server" },
            leaveScreen = { events += "screen" },
        )

        assertEquals(listOf("local", "mumble"), events.take(2))
        assertTrue(events.drop(2).containsAll(listOf("server", "screen")))
    }

    @Test
    fun nativeDisconnectFailureDoesNotSkipPresenceAndScreenCleanup() = runBlocking {
        var serverLeft = false
        var screenLeft = false

        leaveVoiceSafely(
            onLocalLeave = {},
            disconnectVoice = { error("native disconnect failed") },
            announceRemoteLeave = { serverLeft = true },
            leaveScreen = { screenLeft = true },
        )

        assertTrue(serverLeft)
        assertTrue(screenLeft)
    }
}
