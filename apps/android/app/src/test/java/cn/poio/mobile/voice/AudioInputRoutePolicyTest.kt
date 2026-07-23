package cn.poio.mobile.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioInputRoutePolicyTest {
    @Test
    fun collapsesDuplicatePhoneMicrophonePorts() {
        val routes = normalizedInputRoutes(
            listOf(
                InputDeviceCandidate(11, "builtin", "内置麦克风"),
                InputDeviceCandidate(12, "builtin", "内置麦克风"),
                InputDeviceCandidate(13, "builtin", "内置麦克风"),
            ),
            preferredId = 12,
        )

        assertEquals(listOf(0, 12), routes.map(VoiceRoute::id))
        assertEquals(listOf("系统默认", "内置麦克风"), routes.map(VoiceRoute::name))
    }

    @Test
    fun keepsDistinctExternalMicrophones() {
        val routes = normalizedInputRoutes(
            listOf(
                InputDeviceCandidate(21, "bluetooth:buds", "蓝牙耳麦 · Buds"),
                InputDeviceCandidate(31, "usb:studio", "USB 麦克风 · Studio"),
            ),
            preferredId = 0,
        )

        assertEquals(3, routes.size)
    }

    @Test
    fun collapsesUndocumentedExternalPortsWithTheSameGenericLabel() {
        val firstKey = inputDeviceGroupKey("type-15", "外部麦克风", "V2408A", "V2408A")
        val secondKey = inputDeviceGroupKey("type-25", "外部麦克风", "V2408A", "V2408A")
        val routes = normalizedInputRoutes(
            listOf(
                InputDeviceCandidate(41, firstKey, "外部麦克风"),
                InputDeviceCandidate(42, secondKey, "外部麦克风"),
            ),
            preferredId = 0,
        )

        assertEquals(listOf("系统默认", "外部麦克风"), routes.map(VoiceRoute::name))
    }

    @Test
    fun keepsNamedUsbAndBluetoothDevicesDistinct() {
        assertEquals(
            "usb:studio mic",
            inputDeviceGroupKey("usb", "USB 麦克风", "Studio Mic", "V2408A"),
        )
        assertEquals(
            "bluetooth:buds",
            inputDeviceGroupKey("bluetooth", "蓝牙耳麦", "Buds", "V2408A"),
        )
    }

    @Test
    fun speechMeterUsesDecibelRangeWithoutEarlySaturation() {
        assertEquals(0f, microphoneMeterLevel(0.0), 0.001f)
        assertEquals(0f, microphoneMeterLevel(0.001), 0.001f)
        assertTrue(microphoneMeterLevel(0.01) in 0.2f..0.5f)
        assertTrue(microphoneMeterLevel(0.1) in 0.7f..0.9f)
        assertEquals(1f, microphoneMeterLevel(1.0), 0.001f)
    }
}
