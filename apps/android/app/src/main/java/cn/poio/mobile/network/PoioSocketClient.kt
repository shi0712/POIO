package cn.poio.mobile.network

import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.Polling
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import cn.poio.mobile.screen.ScreenSignaling
import org.json.JSONObject
import java.net.URI
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class PoioRequestException(message: String) : Exception(message)

class PoioSocketClient(serverUrl: String) : ScreenSignaling {
    private val endpoint = URI(serverUrl)
    private val options = IO.Options().apply {
        path = endpoint.path.trimEnd('/') + "/socket.io"
        transports = arrayOf(WebSocket.NAME, Polling.NAME)
        reconnection = true
        reconnectionDelayMax = 5_000
        timeout = 12_000
    }
    private val origin = "${endpoint.scheme}://${endpoint.authority}"
    private val socket: Socket = IO.socket(origin, options)

    val connected: Boolean get() = socket.connected()

    fun connect(onConnected: () -> Unit, onDisconnected: () -> Unit, onError: (String) -> Unit) {
        socket.off(Socket.EVENT_CONNECT).on(Socket.EVENT_CONNECT) { onConnected() }
        socket.off(Socket.EVENT_DISCONNECT).on(Socket.EVENT_DISCONNECT) { onDisconnected() }
        socket.off(Socket.EVENT_CONNECT_ERROR).on(Socket.EVENT_CONNECT_ERROR) { args ->
            onError(args.firstOrNull()?.toString() ?: "无法连接 POIO 服务")
        }
        socket.connect()
    }

    override fun on(event: String, listener: (Array<out Any>) -> Unit) {
        socket.off(event).on(event) { args -> listener(args) }
    }

    override fun off(event: String) {
        socket.off(event)
    }

    override suspend fun request(event: String, payload: JSONObject): Any? = withTimeout(12_000) {
        suspendCancellableCoroutine { continuation ->
            socket.emit(event, payload, io.socket.client.Ack { args ->
                if (!continuation.isActive) return@Ack
                val envelope = args.firstOrNull() as? JSONObject
                if (envelope == null) {
                    continuation.resumeWithException(PoioRequestException("服务端返回格式错误"))
                } else if (envelope.optBoolean("ok")) {
                    continuation.resume(envelope.opt("value").takeUnless { it === JSONObject.NULL })
                } else {
                    continuation.resumeWithException(PoioRequestException(envelope.optString("error", "请求失败")))
                }
            })
        }
    }

    fun close() {
        socket.off()
        socket.disconnect()
    }
}
