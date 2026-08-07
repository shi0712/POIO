package cn.poio.mobile.model

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PoioJsonTest {
    @Test
    fun parsesAuthPayloadFromDesktopCompatibleEnvelope() {
        val payload = JSONObject(
            """{
              "token":"abcdefghijklmnopqrstuvwxyz0123456789",
              "user":{"id":"u1","username":"sjw","avatarUrl":null,"joinSoundUrl":"/uploads/join.mp3","leaveSoundUrl":"/uploads/leave.mp3"},
              "bootstrap":[{"id":"s1","name":"sjw 的社区","ownerId":"u1","channels":[
                {"id":"c1","name":"欢迎","kind":"text","position":0},
                {"id":"c2","name":"大厅","kind":"voice","position":1}
              ]}]
            }""".trimIndent(),
        )

        val auth = PoioJson.auth(payload)

        assertEquals("sjw", auth.user.username)
        assertEquals("/uploads/join.mp3", auth.user.joinSoundUrl)
        assertEquals("/uploads/leave.mp3", auth.user.leaveSoundUrl)
        assertEquals("大厅", auth.spaces.single().channels.last().name)
        assertEquals(ChannelKind.VOICE, auth.spaces.single().channels.last().kind)
    }

    @Test
    fun parsesMobileCapabilities() {
        val value = JSONObject(
            """{"protocolVersion":1,"serverVersion":"0.3.8","features":{"preferredLayers":true},"media":{"webRtcPort":17921}}""",
        )
        val capabilities = PoioJson.capabilities(value)
        assertTrue(capabilities.preferredLayers)
        assertEquals(17921, capabilities.webRtcPort)
    }

    @Test
    fun parsesUnicodeAttachmentAndAnimatedAvatar() {
        val value = JSONObject(
            """{
              "id":"m1","channelId":"c1","body":"看看这个","createdAt":1784740000000,
              "userId":"u1","username":"测试用户","avatarUrl":"/uploads/avatar.gif",
              "attachmentUrl":"/uploads/file.png","attachmentName":"屏幕截图 你好.png",
              "attachmentSize":2048,"attachmentMime":"image/png"
            }""".trimIndent(),
        )

        val message = PoioJson.message(value)

        assertEquals("屏幕截图 你好.png", message.attachmentName)
        assertEquals("image/png", message.attachmentMime)
        assertEquals(2048L, message.attachmentSize)
        assertEquals("/uploads/avatar.gif", message.avatarUrl)
    }

    @Test
    fun parsesReplyEditDeletionAndReactions() {
        val value = JSONObject(
            """{
              "id":"m2","channelId":"c1","body":"收到","createdAt":1784740000001,
              "editedAt":1784740005000,"deleted":false,
              "userId":"u2","username":"guest",
              "reply":{"id":"m1","userId":"u1","username":"owner","body":"欢迎","deleted":false},
              "reactions":[
                {"emoji":"👍","count":2,"userIds":["u1","u2"]},
                {"emoji":"❤️","count":1,"userIds":["u1"]}
              ]
            }""".trimIndent(),
        )

        val message = PoioJson.message(value)

        assertEquals(1784740005000L, message.editedAt)
        assertEquals("owner", message.reply?.username)
        assertEquals("欢迎", message.reply?.body)
        assertEquals(2, message.reactions.size)
        assertEquals(listOf("u1", "u2"), message.reactions.first().userIds)
        assertEquals(2, message.reactions.first().count)
    }

    @Test
    fun parsesDirectMessagesAndConversationUnreadCount() {
        val message = PoioJson.directMessage(JSONObject(
            """{
              "id":"dm1","senderId":"u2","recipientId":"u1","body":"私聊你好","createdAt":1784740000002,
              "username":"朋友","avatarUrl":"/uploads/friend.gif","attachmentUrl":"/uploads/截图.png",
              "attachmentName":"截图.png","attachmentSize":4096,"attachmentMime":"image/png"
            }""".trimIndent(),
        ))
        val conversation = PoioJson.directConversation(JSONObject(
            """{
              "user":{"id":"u2","username":"朋友"},
              "lastMessage":{"id":"dm1","body":"私聊你好","createdAt":1784740000002,"senderId":"u2"},
              "unreadCount":3
            }""".trimIndent(),
        ))

        assertEquals("朋友", message.username)
        assertEquals("截图.png", message.attachmentName)
        assertEquals(4096L, message.attachmentSize)
        assertEquals("u2", conversation.user.id)
        assertEquals("私聊你好", conversation.lastBody)
        assertEquals(3, conversation.unreadCount)
    }
}
