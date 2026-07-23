package cn.poio.mobile.network

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import cn.poio.mobile.model.UploadedAttachment
import cn.poio.mobile.session.SecureSessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

class AttachmentUploader(
    private val resolver: ContentResolver,
    private val session: SecureSessionStore,
    serverUrl: String,
) {
    private val uploadUrl = serverUrl.trimEnd('/') + "/api/uploads"

    suspend fun upload(
        uri: Uri,
        maxSize: Long = MAX_FILE_SIZE,
        requiredMimePrefix: String? = null,
    ): UploadedAttachment = withContext(Dispatchers.IO) {
        val token = session.readToken() ?: throw IOException("登录已过期，请重新登录")
        val metadata = metadata(uri)
        if (requiredMimePrefix != null && !metadata.mime.startsWith(requiredMimePrefix)) {
            throw IOException("所选文件格式不受支持")
        }
        if (metadata.size != null && metadata.size > maxSize) {
            throw IOException("文件不能超过 ${maxSize / (1024 * 1024)} MB")
        }

        val boundary = "----POIO-${UUID.randomUUID()}"
        val connection = (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 90_000
            doOutput = true
            useCaches = false
            setChunkedStreamingMode(64 * 1024)
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            setRequestProperty("Accept", "application/json")
        }

        try {
            val wireName = String(
                metadata.name.replace('"', '\'').replace('\\', '_').toByteArray(StandardCharsets.UTF_8),
                StandardCharsets.ISO_8859_1,
            )
            connection.outputStream.buffered().use { output ->
                output.write("--$boundary\r\n".toByteArray())
                output.write("Content-Disposition: form-data; name=\"file\"; filename=\"$wireName\"\r\n".toByteArray(StandardCharsets.ISO_8859_1))
                output.write("Content-Type: ${metadata.mime}\r\n\r\n".toByteArray())
                resolver.openInputStream(uri)?.buffered()?.use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var uploaded = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        uploaded += read
                        if (uploaded > maxSize) throw IOException("文件不能超过 ${maxSize / (1024 * 1024)} MB")
                        output.write(buffer, 0, read)
                    }
                } ?: throw IOException("无法读取所选文件")
                output.write("\r\n--$boundary--\r\n".toByteArray())
            }

            val status = connection.responseCode
            val response = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(response) }.getOrNull()
            if (status !in 200..299) {
                throw IOException(json?.optString("error")?.takeIf(String::isNotBlank) ?: "上传失败（HTTP $status）")
            }
            UploadedAttachment(
                url = json?.getString("url") ?: throw IOException("上传响应缺少文件地址"),
                name = json.optString("name", metadata.name),
                size = json.optLong("size", metadata.size ?: 0L),
                mime = json.optString("mime", metadata.mime),
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun metadata(uri: Uri): FileMetadata {
        var name: String? = null
        var size: Long? = null
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0) name = cursor.getString(nameIndex)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        val safeName = name?.trim()?.filter { it.code >= 32 && it.code != 127 }?.takeIf(String::isNotEmpty)
            ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf(String::isNotEmpty)
            ?: "file"
        return FileMetadata(
            name = safeName.take(MAX_FILE_NAME_LENGTH),
            size = size,
            mime = resolver.getType(uri)?.takeIf(String::isNotBlank) ?: "application/octet-stream",
        )
    }

    private data class FileMetadata(val name: String, val size: Long?, val mime: String)

    private companion object {
        const val MAX_FILE_SIZE = 50L * 1024 * 1024
        const val MAX_FILE_NAME_LENGTH = 255
    }
}
