package cn.poio.mobile.screen

import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenGestureMathTest {
    @Test
    fun oneTimesScaleAlwaysCentersTheScreen() {
        assertEquals(0f, clampScreenPan(500f, 1080, 1f), 0.001f)
        assertEquals(0f, clampScreenPan(-500f, 1080, 0.5f), 0.001f)
    }

    @Test
    fun clampsPanToScaledViewportBounds() {
        assertEquals(540f, clampScreenPan(900f, 1080, 2f), 0.001f)
        assertEquals(-540f, clampScreenPan(-900f, 1080, 2f), 0.001f)
        assertEquals(120f, clampScreenPan(120f, 1080, 2f), 0.001f)
    }

    @Test
    fun emptyViewportHasNoPanRange() {
        assertEquals(0f, clampScreenPan(100f, 0, 4f), 0.001f)
    }
}
