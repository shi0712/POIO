package cn.poio.mobile.voice

import kotlin.math.log10

internal data class InputDeviceCandidate(
    val id: Int,
    val groupKey: String,
    val label: String,
)

/**
 * Some vendors publish several undocumented source types with the same generic
 * product name. Treat those as one physical "external microphone" choice while
 * keeping genuinely named USB, Bluetooth and wired devices separate.
 */
internal fun inputDeviceGroupKey(
    family: String,
    fallbackLabel: String,
    productName: String,
    phoneModel: String,
): String {
    if (family == "builtin" || family == "telephony") return family
    val distinguishableProduct = productName
        .trim()
        .takeIf { it.isNotBlank() && !it.equals(phoneModel, ignoreCase = true) }
    return when {
        distinguishableProduct != null -> "$family:${distinguishableProduct.lowercase()}"
        fallbackLabel == "外部麦克风" -> "generic-external"
        else -> family
    }
}

/**
 * Android phones often expose every internal microphone port with the same
 * product name (for example the phone model). Keep one useful choice per
 * physical device family and preserve the selected port when possible.
 */
internal fun normalizedInputRoutes(
    candidates: List<InputDeviceCandidate>,
    preferredId: Int,
): List<VoiceRoute> {
    val ordered = candidates.sortedByDescending { it.id == preferredId }
    return listOf(VoiceRoute(0, "系统默认")) +
        ordered.distinctBy(InputDeviceCandidate::groupKey).map { VoiceRoute(it.id, it.label) }
}

/**
 * Convert PCM RMS to a useful speech meter. A linear gain saturates on phones
 * with automatic gain control, so use a -55 dBFS to -10 dBFS speech range.
 */
internal fun microphoneMeterLevel(rms: Double): Float {
    if (!rms.isFinite() || rms <= 0.0) return 0f
    val decibels = 20.0 * log10(rms.coerceAtLeast(0.000001))
    return ((decibels - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB))
        .toFloat()
        .coerceIn(0f, 1f)
}

private const val METER_FLOOR_DB = -55.0
private const val METER_CEILING_DB = -10.0
