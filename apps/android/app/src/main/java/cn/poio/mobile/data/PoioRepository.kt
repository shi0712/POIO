package cn.poio.mobile.data

import android.content.ContentResolver
import android.net.Uri
import cn.poio.mobile.BuildConfig
import cn.poio.mobile.model.AuthPayload
import cn.poio.mobile.model.Channel
import cn.poio.mobile.model.ChatMessage
import cn.poio.mobile.model.PoioJson
import cn.poio.mobile.model.ServerCapabilities
import cn.poio.mobile.model.Space
import cn.poio.mobile.model.User
import cn.poio.mobile.model.objects
import cn.poio.mobile.network.PoioSocketClient
import cn.poio.mobile.network.AttachmentUploader
import cn.poio.mobile.session.SecureSessionStore
import cn.poio.mobile.session.isExpiredSessionFailure
import cn.poio.mobile.voice.MumbleCredentials
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class PoioState(
    val connecting: Boolean = true,
    val connected: Boolean = false,
    val authenticated: Boolean = false,
    val busy: Boolean = false,
    val user: User? = null,
    val spaces: List<Space> = emptyList(),
    val selectedSpaceId: String? = null,
    val selectedChannelId: String? = null,
    val messages: List<ChatMessage> = emptyList(),
    val capabilities: ServerCapabilities? = null,
    val voiceChannelId: String? = null,
    val voiceMembers: Map<String, List<User>> = emptyMap(),
    val inviteCode: String? = null,
    /** Increments only after this Socket.IO connection has authenticated. */
    val authenticatedConnectionGeneration: Long = 0,
    val error: String? = null,
) {
    val selectedSpace get() = spaces.firstOrNull { it.id == selectedSpaceId } ?: spaces.firstOrNull()
    val selectedChannel get() = selectedSpace?.channels?.firstOrNull { it.id == selectedChannelId } ?: selectedSpace?.channels?.firstOrNull()
}

class PoioRepository(
    private val scope: CoroutineScope,
    private val session: SecureSessionStore,
    contentResolver: ContentResolver,
) {
    internal val client = PoioSocketClient(BuildConfig.POIO_SERVER_URL)
    private val uploader = AttachmentUploader(contentResolver, session, BuildConfig.POIO_SERVER_URL)
    private val mutableState = MutableStateFlow(PoioState())
    val state: StateFlow<PoioState> = mutableState.asStateFlow()
    private var restoreJob: Job? = null

    fun start() {
        client.on("chat:message") { args ->
            val value = args.firstOrNull() as? JSONObject ?: return@on
            val message = runCatching { PoioJson.message(value) }.getOrNull() ?: return@on
            mutableState.value = mutableState.value.let { current ->
                if (message.channelId != current.selectedChannelId || current.messages.any { it.id == message.id }) current
                else current.copy(messages = current.messages + message)
            }
        }
        client.on("channel:created") { args ->
            val value = args.firstOrNull() as? JSONObject ?: return@on
            val channel = runCatching { PoioJson.channel(value) }.getOrNull() ?: return@on
            mutableState.value = mutableState.value.copy(spaces = mutableState.value.spaces.map { space ->
                if (space.id == channel.spaceId && space.channels.none { it.id == channel.id }) space.copy(channels = space.channels + channel) else space
            })
        }
        client.on("voice:presence") { args ->
            val value = args.firstOrNull() as? JSONObject ?: return@on
            val channelId = value.optString("channelId").takeIf(String::isNotBlank) ?: return@on
            val users = value.optJSONArray("users").objects().map(PoioJson::user)
            mutableState.value = mutableState.value.copy(
                voiceMembers = mutableState.value.voiceMembers + (channelId to users),
            )
        }
        client.on("user:updated") { args ->
            val value = args.firstOrNull() as? JSONObject ?: return@on
            val user = runCatching { PoioJson.user(value) }.getOrNull() ?: return@on
            applyUserUpdate(user)
        }
        client.connect(
            onConnected = {
                mutableState.value = mutableState.value.copy(connecting = false, connected = true, error = null)
                restoreJob?.cancel()
                restoreJob = scope.launch { restoreOrDiscover() }
            },
            onDisconnected = {
                mutableState.value = mutableState.value.copy(
                    connected = false,
                    connecting = true,
                )
            },
            onError = {
                // Socket.IO already retries automatically. Connection failures
                // are represented by the persistent in-app network banner; raw
                // EngineIOException details must never leak into a Snackbar.
                mutableState.value = mutableState.value.copy(
                    connecting = true,
                    connected = false,
                )
            },
        )
    }

    suspend fun login(username: String, password: String, register: Boolean) = guarded {
        val event = if (register) "auth:register" else "auth:login"
        val value = client.request(event, JSONObject().put("username", username.trim()).put("password", password)) as JSONObject
        applyAuth(PoioJson.auth(value))
    }

    suspend fun logout() = guarded {
        val token = session.readToken()
        if (token != null) runCatching { client.request("auth:logout", JSONObject().put("token", token)) }
        session.clear()
        mutableState.value = PoioState(connecting = false, connected = client.connected)
    }

    suspend fun selectSpace(spaceId: String) {
        val space = mutableState.value.spaces.firstOrNull { it.id == spaceId } ?: return
        mutableState.value = mutableState.value.copy(selectedSpaceId = space.id, selectedChannelId = space.channels.firstOrNull()?.id, messages = emptyList())
        mutableState.value.selectedChannel?.let { selectChannel(it.id) }
    }

    suspend fun selectChannel(channelId: String) = guarded(showBusy = false) {
        mutableState.value = mutableState.value.copy(selectedChannelId = channelId, messages = emptyList())
        client.request("channel:watch", JSONObject().put("channelId", channelId))
        val history = client.request("chat:history", JSONObject().put("channelId", channelId)) as JSONArray
        mutableState.value = mutableState.value.copy(messages = history.objects().map(PoioJson::message))
    }

    suspend fun sendMessage(body: String) = guarded(showBusy = false) {
        val channelId = mutableState.value.selectedChannelId ?: return@guarded
        if (body.isBlank()) return@guarded
        client.request("chat:send", JSONObject().put("channelId", channelId).put("body", body.trim()))
    }

    suspend fun sendAttachment(uri: Uri, body: String) = guarded {
        val channelId = mutableState.value.selectedChannelId ?: return@guarded
        val attachment = uploader.upload(uri)
        client.request(
            "chat:send",
            JSONObject()
                .put("channelId", channelId)
                .put("body", body.trim())
                .put(
                    "attachment",
                    JSONObject()
                        .put("url", attachment.url)
                        .put("name", attachment.name)
                        .put("size", attachment.size)
                        .put("mime", attachment.mime),
                ),
        )
    }

    suspend fun updateAvatar(uri: Uri) = guarded {
        val attachment = uploader.upload(uri, maxSize = 10L * 1024 * 1024, requiredMimePrefix = "image/")
        val value = client.request("user:avatar", JSONObject().put("url", attachment.url)) as JSONObject
        applyUserUpdate(PoioJson.user(value))
    }

    suspend fun createSpace(name: String) = guarded {
        val value = client.request("space:create", JSONObject().put("name", name.trim())) as JSONObject
        val space = PoioJson.space(value)
        mutableState.value = mutableState.value.copy(spaces = mutableState.value.spaces + space)
        selectSpace(space.id)
    }

    suspend fun joinSpace(code: String) = guarded {
        val value = client.request("space:join", JSONObject().put("code", code.trim())) as JSONObject
        val space = PoioJson.space(value)
        mutableState.value = mutableState.value.copy(spaces = mutableState.value.spaces.filterNot { it.id == space.id } + space)
        selectSpace(space.id)
    }

    suspend fun createSpaceInvite() = guarded {
        val spaceId = mutableState.value.selectedSpaceId ?: return@guarded
        val value = client.request("space:invite", JSONObject().put("spaceId", spaceId)) as JSONObject
        mutableState.value = mutableState.value.copy(inviteCode = value.getString("code"))
    }

    fun clearSpaceInvite() {
        mutableState.value = mutableState.value.copy(inviteCode = null)
    }

    suspend fun createChannel(name: String, voice: Boolean) = guarded {
        val spaceId = mutableState.value.selectedSpaceId ?: return@guarded
        client.request(
            "channel:create",
            JSONObject().put("spaceId", spaceId).put("name", name.trim()).put("kind", if (voice) "voice" else "text"),
        )
    }

    suspend fun voiceCredentials(channelId: String): MumbleCredentials {
        val value = client.request("voice:credentials", JSONObject().put("channelId", channelId)) as JSONObject
        return MumbleCredentials(
            host = value.getString("host"),
            port = value.getInt("port"),
            username = value.getString("username"),
            password = value.getString("password"),
            channelName = value.getString("channelName"),
        )
    }

    suspend fun announceVoiceJoin(channelId: String) {
        val value = client.request("voice:join", JSONObject().put("channelId", channelId)) as JSONObject
        val users = value.optJSONArray("users").objects().map(PoioJson::user)
        mutableState.value = mutableState.value.copy(
            voiceChannelId = channelId,
            voiceMembers = mutableState.value.voiceMembers + (channelId to users),
        )
    }

    suspend fun announceVoiceLeave() {
        client.request("voice:leave")
    }

    fun markVoiceLeftLocally() {
        mutableState.value = mutableState.value.copy(voiceChannelId = null)
    }

    fun reportError(error: Throwable) {
        mutableState.value = mutableState.value.copy(error = error.message ?: "请求失败")
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(error = null)
    }

    fun close() = client.close()

    private suspend fun restoreOrDiscover() {
        val token = session.readToken()
        if (token == null) {
            mutableState.value = mutableState.value.copy(connecting = false)
            discoverCapabilities()
            return
        }

        var retryDelay = 500L
        while (client.connected && currentCoroutineContext().isActive) {
            val result = runCatching {
                val value = client.request("auth:resume", JSONObject().put("token", token)) as JSONObject
                applyAuth(PoioJson.auth(value))
            }
            if (result.isSuccess) {
                discoverCapabilities()
                return
            }

            val error = result.exceptionOrNull() ?: return
            if (isExpiredSessionFailure(error)) {
                session.clear()
                mutableState.value = mutableState.value.copy(
                    connecting = false,
                    authenticated = false,
                    user = null,
                    spaces = emptyList(),
                    error = "登录已过期，请重新登录",
                )
                return
            }

            // Preserve the token for network failures. The loading screen stays
            // visible and recovery retries without asking for the password.
            mutableState.value = mutableState.value.copy(
                connecting = true,
                error = null,
            )
            delay(retryDelay)
            retryDelay = (retryDelay * 2).coerceAtMost(10_000L)
        }
    }

    private fun discoverCapabilities() {
        scope.launch {
            runCatching {
                val capabilities = client.request("app:capabilities") as JSONObject
                mutableState.value = mutableState.value.copy(capabilities = PoioJson.capabilities(capabilities))
            }
        }
    }

    private suspend fun applyAuth(payload: AuthPayload) {
        session.writeToken(payload.token)
        val current = mutableState.value
        val selectedSpace = payload.spaces.firstOrNull { it.id == current.selectedSpaceId }
            ?: payload.spaces.firstOrNull()
        val selectedChannel = selectedSpace?.channels?.firstOrNull { it.id == current.selectedChannelId }
            ?: selectedSpace?.channels?.firstOrNull()
        mutableState.value = current.copy(
            authenticated = true,
            busy = false,
            user = payload.user,
            spaces = payload.spaces,
            selectedSpaceId = selectedSpace?.id,
            selectedChannelId = selectedChannel?.id,
            authenticatedConnectionGeneration = current.authenticatedConnectionGeneration + 1,
            error = null,
        )
        mutableState.value.selectedChannelId?.let { selectChannel(it) }
    }

    private fun applyUserUpdate(user: User) {
        val current = mutableState.value
        mutableState.value = current.copy(
            user = if (current.user?.id == user.id) user else current.user,
            messages = current.messages.map { message ->
                if (message.userId == user.id) message.copy(username = user.username, avatarUrl = user.avatarUrl) else message
            },
            voiceMembers = current.voiceMembers.mapValues { (_, members) ->
                members.map { member -> if (member.id == user.id) user else member }
            },
        )
    }

    private suspend fun guarded(showBusy: Boolean = true, block: suspend () -> Unit) {
        if (showBusy) mutableState.value = mutableState.value.copy(busy = true, error = null)
        runCatching { block() }.onFailure { error ->
            mutableState.value = mutableState.value.copy(error = error.message ?: "请求失败")
        }
        if (showBusy) mutableState.value = mutableState.value.copy(busy = false)
    }
}
