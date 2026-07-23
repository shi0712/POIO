package cn.poio.mobile.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeakingStatePolicyTest {
    @Test
    fun incomingAudioMarksOnlyTheMatchingMumbleSessionAsTalking() {
        assertEquals(setOf(42), updatedTalkingSessions(emptySet(), 42, talking = true))
    }

    @Test
    fun repeatedAudioKeepsTalkingStateIdempotent() {
        assertEquals(setOf(42), updatedTalkingSessions(setOf(42), 42, talking = true))
    }

    @Test
    fun hangoverOrUserRemovalClearsOnlyTheMatchingSession() {
        assertEquals(setOf(7), updatedTalkingSessions(setOf(7, 42), 42, talking = false))
    }
}
