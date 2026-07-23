package cn.poio.mobile.voice

internal data class EffectiveVoiceControls(
    val muted: Boolean,
    val deafened: Boolean,
)

/**
 * Audio focus suppression is temporary and must not overwrite the user's own
 * mute/deafen preferences. Self-deafen always implies self-mute in Mumble.
 */
internal fun effectiveVoiceControls(
    userMuted: Boolean,
    userDeafened: Boolean,
    focusSuppressed: Boolean,
): EffectiveVoiceControls = EffectiveVoiceControls(
    muted = userMuted || userDeafened || focusSuppressed,
    deafened = userDeafened || focusSuppressed,
)
