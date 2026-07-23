package cn.poio.mobile.screen

import cn.poio.mobile.model.Channel
import cn.poio.mobile.model.ChannelKind

/**
 * A screen receiver is allowed only for the voice channel that the account has
 * actually joined. Merely selecting a voice channel to show the join
 * confirmation must not create a hidden WebRTC session.
 */
internal fun screenReceiverChannel(selectedChannel: Channel?, joinedVoiceChannelId: String?): String? =
    selectedChannel
        ?.takeIf { it.kind == ChannelKind.VOICE && it.id == joinedVoiceChannelId }
        ?.id

internal fun screenReconnectDelayMillis(attempt: Int): Long {
    val exponent = attempt.coerceIn(0, 4)
    return (1_000L shl exponent).coerceAtMost(15_000L)
}
