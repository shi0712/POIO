package cn.poio.mobile.ui

import cn.poio.mobile.model.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Test

class MessageActionsTest {
    @Test
    fun copyPrefersTheMessageBody() {
        val message = message(body = "一段可以复制的消息", attachmentUrl = "/uploads/image.png")
        assertEquals("一段可以复制的消息", messageCopyText(message))
    }

    @Test
    fun attachmentOnlyMessageCopiesItsUrl() {
        val message = message(body = "", attachmentUrl = "/uploads/file.zip")
        assertEquals("/uploads/file.zip", messageCopyText(message))
    }

    private fun message(body: String, attachmentUrl: String?) = ChatMessage(
        id = "message-a",
        channelId = "channel-a",
        body = body,
        createdAt = 1L,
        userId = "user-a",
        username = "Alice",
        attachmentUrl = attachmentUrl,
    )
}
