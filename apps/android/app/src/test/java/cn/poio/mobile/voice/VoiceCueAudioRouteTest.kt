package cn.poio.mobile.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceCueAudioRouteTest {
    @Test
    fun cuesFollowTheActiveCommunicationRouteAndFallBackToMediaAfterLeaving() {
        assertEquals(VoiceCueAudioRoute.COMMUNICATION, voiceCueAudioRoute(inCommunicationMode = true))
        assertEquals(VoiceCueAudioRoute.MEDIA, voiceCueAudioRoute(inCommunicationMode = false))
    }
}
