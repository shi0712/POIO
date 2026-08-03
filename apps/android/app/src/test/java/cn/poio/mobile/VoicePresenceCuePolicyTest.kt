package cn.poio.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoicePresenceCuePolicyTest {
    @Test
    fun onlyOtherMembersInTheActiveVoiceChannelProducePresenceCues() {
        assertTrue(shouldPlayVoicePresenceCue("lobby", "me", "lobby", "friend"))
        assertFalse(shouldPlayVoicePresenceCue("lobby", "me", "gaming", "friend"))
        assertFalse(shouldPlayVoicePresenceCue("lobby", "me", "lobby", "me"))
        assertFalse(shouldPlayVoicePresenceCue(null, "me", "lobby", "friend"))
    }
}
