package cn.poio.mobile.screen

/**
 * Keeps a zoomed screen inside the viewport. At 1x the image is centered and
 * cannot be dragged; every extra scaled pixel becomes available pan distance.
 */
internal fun clampScreenPan(value: Float, viewportPixels: Int, scale: Float): Float {
    val normalizedScale = scale.coerceAtLeast(1f)
    val maxOffset = viewportPixels.coerceAtLeast(0) * (normalizedScale - 1f) / 2f
    return value.coerceIn(-maxOffset, maxOffset)
}
