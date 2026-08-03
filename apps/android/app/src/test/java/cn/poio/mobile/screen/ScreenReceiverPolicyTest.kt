package cn.poio.mobile.screen

import cn.poio.mobile.model.Channel
import cn.poio.mobile.model.ChannelKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenReceiverPolicyTest {
    private val voice = Channel("voice-a", "大厅", ChannelKind.VOICE)
    private val otherVoice = Channel("voice-b", "开黑", ChannelKind.VOICE)
    private val text = Channel("text-a", "欢迎", ChannelKind.TEXT)

    @Test
    fun selectingVoiceWithoutJoiningDoesNotReceiveScreen() {
        assertNull(screenReceiverChannel(voice, null))
    }

    @Test
    fun onlyTheJoinedAndVisibleVoiceChannelReceivesScreen() {
        assertEquals("voice-a", screenReceiverChannel(voice, "voice-a"))
        assertNull(screenReceiverChannel(otherVoice, "voice-a"))
        assertNull(screenReceiverChannel(text, "voice-a"))
    }

    @Test
    fun hangingUpStopsScreenReceiver() {
        assertNull(screenReceiverChannel(voice, null))
    }

    @Test
    fun reconnectDelayUsesBoundedExponentialBackoff() {
        assertEquals(1_000L, screenReconnectDelayMillis(0))
        assertEquals(2_000L, screenReconnectDelayMillis(1))
        assertEquals(4_000L, screenReconnectDelayMillis(2))
        assertEquals(8_000L, screenReconnectDelayMillis(3))
        assertEquals(15_000L, screenReconnectDelayMillis(4))
        assertEquals(15_000L, screenReconnectDelayMillis(20))
    }

    @Test
    fun screenAudioPreferenceOnlyDisablesTheSharedAudioTrack() {
        assertFalse(shouldEnableRemoteScreenTrack("screen-audio", "audio", screenAudioEnabled = false))
        assertTrue(shouldEnableRemoteScreenTrack("screen-audio", "audio", screenAudioEnabled = true))
        assertTrue(shouldEnableRemoteScreenTrack("screen", "video", screenAudioEnabled = false))
        assertTrue(shouldEnableRemoteScreenTrack("voice", "audio", screenAudioEnabled = false))
    }

    @Test
    fun emptyConsumerAppDataFallsBackToTheProducerScreenTag() {
        assertEquals("screen", resolveScreenMediaTag("", "screen", "video"))
        assertEquals("screen-audio", resolveScreenMediaTag(null, "screen-audio", "audio"))
    }

    @Test
    fun consumerTagWinsAndKindIsTheLastFallback() {
        assertEquals("screen", resolveScreenMediaTag("screen", "ignored", "video"))
        assertEquals("video", resolveScreenMediaTag(null, null, "video"))
    }
}
