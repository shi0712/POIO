package cn.poio.mobile.model

import org.json.JSONArray
import org.json.JSONObject

data class User(
    val id: String,
    val username: String,
    val avatarUrl: String? = null,
    val role: String? = null,
    val joinSoundUrl: String? = null,
    val leaveSoundUrl: String? = null,
)
data class Channel(val id: String, val name: String, val kind: ChannelKind, val spaceId: String? = null, val position: Int = 0)
enum class ChannelKind { TEXT, VOICE }
data class Space(val id: String, val name: String, val ownerId: String, val channels: List<Channel>)
data class ChatReply(
    val id: String,
    val userId: String,
    val username: String,
    val body: String,
    val attachmentName: String? = null,
    val deleted: Boolean = false,
)
data class ChatReaction(
    val emoji: String,
    val count: Int,
    val userIds: List<String>,
)
data class ChatMessage(
    val id: String,
    val channelId: String,
    val body: String,
    val createdAt: Long,
    val editedAt: Long? = null,
    val deleted: Boolean = false,
    val userId: String,
    val username: String,
    val avatarUrl: String? = null,
    val attachmentUrl: String? = null,
    val attachmentName: String? = null,
    val attachmentSize: Long? = null,
    val attachmentMime: String? = null,
    val reply: ChatReply? = null,
    val reactions: List<ChatReaction> = emptyList(),
)
data class DirectMessage(
    val id: String,
    val senderId: String,
    val recipientId: String,
    val body: String,
    val createdAt: Long,
    val username: String,
    val avatarUrl: String? = null,
    val attachmentUrl: String? = null,
    val attachmentName: String? = null,
    val attachmentSize: Long? = null,
    val attachmentMime: String? = null,
)
data class DirectGameInvitation(val gameId: String, val spaceId: String, val roomId: String, val wager: Long, val pot: Long, val expiresAt: Long, val smallBlind: Long = 0)
fun parseDirectGameInvitation(body: String): DirectGameInvitation? {
    if (body.startsWith("[[POIO:GAME:INVITE:1]]|")) return runCatching {
        val encoded = body.substringAfter('|')
        val value = JSONObject(String(android.util.Base64.decode(encoded, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP), Charsets.UTF_8))
        val gameId=value.optString("gameId");if(gameId!="gomoku"&&gameId!="texas-holdem")return null
        DirectGameInvitation(gameId,value.getString("spaceId"), value.getString("roomId"), value.optLong("wager"), value.optLong("pot"), value.optLong("expiresAt"),value.optJSONObject("metadata")?.optLong("smallBlind")?:0)
    }.getOrNull()
    val parts = body.split('|')
    if (parts.size != 6 || parts[0] != "[[POIO:GOMOKU:INVITE:1]]") return null
    return DirectGameInvitation("gomoku",parts[1], parts[2], parts[3].toLongOrNull() ?: return null, parts[4].toLongOrNull() ?: return null, parts[5].toLongOrNull() ?: return null)
}
data class DirectConversation(
    val user: User,
    val lastBody: String,
    val lastCreatedAt: Long,
    val lastAttachmentName: String? = null,
    val lastSenderId: String,
    val unreadCount: Int,
)
data class UploadedAttachment(
    val url: String,
    val name: String,
    val size: Long,
    val mime: String,
)
data class AuthPayload(val token: String, val user: User, val spaces: List<Space>)
data class ServerCapabilities(
    val protocolVersion: Int,
    val serverVersion: String,
    val preferredLayers: Boolean,
    val webRtcPort: Int,
)

object PoioJson {
    fun user(value: JSONObject) = User(
        id = value.getString("id"),
        username = value.getString("username"),
        avatarUrl = value.nullableString("avatarUrl"),
        role = value.nullableString("role"),
        joinSoundUrl = value.nullableString("joinSoundUrl"),
        leaveSoundUrl = value.nullableString("leaveSoundUrl"),
    )

    fun channel(value: JSONObject) = Channel(
        id = value.getString("id"),
        name = value.getString("name"),
        kind = if (value.optString("kind") == "voice") ChannelKind.VOICE else ChannelKind.TEXT,
        spaceId = value.nullableString("spaceId"),
        position = value.optInt("position", 0),
    )

    fun space(value: JSONObject) = Space(
        id = value.getString("id"),
        name = value.getString("name"),
        ownerId = value.getString("ownerId"),
        channels = value.optJSONArray("channels").objects().map(::channel),
    )

    fun message(value: JSONObject) = ChatMessage(
        id = value.getString("id"),
        channelId = value.getString("channelId"),
        body = value.optString("body"),
        createdAt = value.getLong("createdAt"),
        editedAt = value.takeIf { it.has("editedAt") && !it.isNull("editedAt") }?.getLong("editedAt"),
        deleted = value.optBoolean("deleted"),
        userId = value.getString("userId"),
        username = value.getString("username"),
        avatarUrl = value.nullableString("avatarUrl"),
        attachmentUrl = value.nullableString("attachmentUrl"),
        attachmentName = value.nullableString("attachmentName"),
        attachmentSize = value.takeIf { it.has("attachmentSize") && !it.isNull("attachmentSize") }?.getLong("attachmentSize"),
        attachmentMime = value.nullableString("attachmentMime"),
        reply = value.optJSONObject("reply")?.let(::reply),
        reactions = value.optJSONArray("reactions").objects().map(::reaction),
    )

    fun reply(value: JSONObject) = ChatReply(
        id = value.getString("id"),
        userId = value.getString("userId"),
        username = value.getString("username"),
        body = value.optString("body"),
        attachmentName = value.nullableString("attachmentName"),
        deleted = value.optBoolean("deleted"),
    )

    fun reaction(value: JSONObject) = ChatReaction(
        emoji = value.getString("emoji"),
        count = value.optInt("count"),
        userIds = value.optJSONArray("userIds").strings(),
    )

    fun directMessage(value: JSONObject) = DirectMessage(
        id = value.getString("id"),
        senderId = value.getString("senderId"),
        recipientId = value.getString("recipientId"),
        body = value.optString("body"),
        createdAt = value.getLong("createdAt"),
        username = value.getString("username"),
        avatarUrl = value.nullableString("avatarUrl"),
        attachmentUrl = value.nullableString("attachmentUrl"),
        attachmentName = value.nullableString("attachmentName"),
        attachmentSize = value.takeIf { it.has("attachmentSize") && !it.isNull("attachmentSize") }?.getLong("attachmentSize"),
        attachmentMime = value.nullableString("attachmentMime"),
    )

    fun directConversation(value: JSONObject): DirectConversation {
        val last = value.getJSONObject("lastMessage")
        return DirectConversation(
            user = user(value.getJSONObject("user")),
            lastBody = last.optString("body"),
            lastCreatedAt = last.getLong("createdAt"),
            lastAttachmentName = last.nullableString("attachmentName"),
            lastSenderId = last.getString("senderId"),
            unreadCount = value.optInt("unreadCount"),
        )
    }

    fun auth(value: JSONObject) = AuthPayload(
        token = value.getString("token"),
        user = user(value.getJSONObject("user")),
        spaces = value.getJSONArray("bootstrap").objects().map(::space),
    )

    fun capabilities(value: JSONObject) = ServerCapabilities(
        protocolVersion = value.getInt("protocolVersion"),
        serverVersion = value.getString("serverVersion"),
        preferredLayers = value.getJSONObject("features").optBoolean("preferredLayers"),
        webRtcPort = value.getJSONObject("media").getInt("webRtcPort"),
    )
}

private fun JSONObject.nullableString(name: String): String? =
    if (!has(name) || isNull(name)) null else optString(name).takeIf(String::isNotBlank)

fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return buildList(length()) { for (index in 0 until length()) add(getJSONObject(index)) }
}

private fun JSONArray?.strings(): List<String> {
    if (this == null) return emptyList()
    return buildList(length()) { for (index in 0 until length()) add(getString(index)) }
}
