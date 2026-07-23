package cn.poio.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatImePolicyTest {
    @Test
    fun windowNotResized_usesFullKeyboardInset() {
        assertEquals(
            720,
            remainingImeInset(
                imeBottomPx = 720,
                navigationBottomPx = 48,
                largestContainerHeightPx = 1600,
                currentContainerHeightPx = 1600,
            ),
        )
    }

    @Test
    fun windowFullyResized_keepsOnlyNavigationInset() {
        assertEquals(
            48,
            remainingImeInset(
                imeBottomPx = 720,
                navigationBottomPx = 48,
                largestContainerHeightPx = 1600,
                currentContainerHeightPx = 880,
            ),
        )
    }

    @Test
    fun windowPartiallyResized_addsOnlyUncoveredRemainder() {
        assertEquals(
            320,
            remainingImeInset(
                imeBottomPx = 720,
                navigationBottomPx = 48,
                largestContainerHeightPx = 1600,
                currentContainerHeightPx = 1200,
            ),
        )
    }
}
