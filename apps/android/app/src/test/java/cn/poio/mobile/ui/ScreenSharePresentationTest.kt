package cn.poio.mobile.ui

import cn.poio.mobile.model.User
import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenSharePresentationTest {
    @Test
    fun sharedScreenUsesTheCommunityMemberName() {
        val members = listOf(
            User(id = "user-a", username = "Alice"),
            User(id = "user-b", username = "小明"),
        )

        assertEquals("小明", screenShareOwnerName("user-b", members))
    }

    @Test
    fun unknownOrBlankMemberNamesHaveAReadableFallback() {
        assertEquals("频道成员", screenShareOwnerName("missing", emptyList()))
        assertEquals("频道成员", screenShareOwnerName("user-a", listOf(User("user-a", " "))))
    }
}
