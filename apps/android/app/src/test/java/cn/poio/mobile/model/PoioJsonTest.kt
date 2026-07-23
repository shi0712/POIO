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
              "user":{"id":"u1","username":"sjw","avatarUrl":null},
              "bootstrap":[{"id":"s1","name":"sjw 的社区","ownerId":"u1","channels":[
                {"id":"c1","name":"欢迎","kind":"text","position":0},
                {"id":"c2","name":"大厅","kind":"voice","position":1}
              ]}]
            }""".trimIndent(),
        )

        val auth = PoioJson.auth(payload)

        assertEquals("sjw", auth.user.username)
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
}
