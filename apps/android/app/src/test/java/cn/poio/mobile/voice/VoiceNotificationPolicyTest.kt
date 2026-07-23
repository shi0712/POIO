package cn.poio.mobile.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceNotificationPolicyTest {
    @Test
    fun notificationMuteActionTogglesTheEffectiveConnectedState() {
        assertEquals(
            true,
            nextNotificationMuteState(VoiceState.Connected(channelName = "大厅", muted = false)),
        )
        assertEquals(
            false,
            nextNotificationMuteState(VoiceState.Connected(channelName = "大厅", muted = true)),
        )
    }

    @Test
    fun notificationMuteActionIsIgnoredOutsideAnActiveConnection() {
        assertNull(nextNotificationMuteState(VoiceState.Idle))
        assertNull(nextNotificationMuteState(VoiceState.Connecting))
        assertNull(nextNotificationMuteState(VoiceState.Failed("offline")))
    }
}
