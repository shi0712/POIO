package cn.poio.mobile.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioFocusPolicyTest {
    @Test
    fun focusLossTemporarilySuppressesCaptureAndPlayback() {
        assertEquals(
            EffectiveVoiceControls(muted = true, deafened = true),
            effectiveVoiceControls(userMuted = false, userDeafened = false, focusSuppressed = true),
        )
    }

    @Test
    fun focusGainRestoresUserPreference() {
        assertEquals(
            EffectiveVoiceControls(muted = false, deafened = false),
            effectiveVoiceControls(userMuted = false, userDeafened = false, focusSuppressed = false),
        )
        assertEquals(
            EffectiveVoiceControls(muted = true, deafened = false),
            effectiveVoiceControls(userMuted = true, userDeafened = false, focusSuppressed = false),
        )
    }

    @Test
    fun selfDeafenAlwaysImpliesSelfMute() {
        assertEquals(
            EffectiveVoiceControls(muted = true, deafened = true),
            effectiveVoiceControls(userMuted = false, userDeafened = true, focusSuppressed = false),
        )
    }
}
