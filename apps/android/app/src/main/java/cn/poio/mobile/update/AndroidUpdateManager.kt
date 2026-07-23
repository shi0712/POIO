package cn.poio.mobile.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import cn.poio.mobile.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

data class AndroidUpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    val sha256: String,
    val size: Long,
    val notes: String,
)

sealed interface AndroidUpdateState {
    data object Idle : AndroidUpdateState
    data object Checking : AndroidUpdateState
    data object UpToDate : AndroidUpdateState
    data class Available(val info: AndroidUpdateInfo) : AndroidUpdateState
    data class Downloading(
        val info: AndroidUpdateInfo,
        val downloadedBytes: Long = 0,
        val totalBytes: Long = info.size,
    ) : AndroidUpdateState
    data class Verifying(val info: AndroidUpdateInfo) : AndroidUpdateState
    data class ReadyToInstall(val info: AndroidUpdateInfo) : AndroidUpdateState
    data class Failed(val message: String) : AndroidUpdateState
}

class AndroidUpdateChecker(private val baseUrl: String = BuildConfig.POIO_SERVER_URL) {
    suspend fun check(): AndroidUpdateState = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL("${baseUrl.trimEnd('/')}/download/android-update.json")
                .openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                connection.setRequestProperty("Accept", "application/json")
                check(connection.responseCode == HttpURLConnection.HTTP_OK) {
                    "更新服务返回 HTTP ${connection.responseCode}"
                }
                val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val info = parseAndroidUpdate(JSONObject(body), baseUrl)
                if (info.versionCode > BuildConfig.VERSION_CODE) {
                    AndroidUpdateState.Available(info)
                } else {
                    AndroidUpdateState.UpToDate
                }
            } finally {
                connection.disconnect()
            }
        }.getOrElse { AndroidUpdateState.Failed(it.message ?: "无法检查更新") }
    }
}

internal fun parseAndroidUpdate(value: JSONObject, baseUrl: String): AndroidUpdateInfo {
    val versionCode = value.getInt("versionCode")
    val versionName = value.getString("versionName").trim()
    val rawUrl = value.getString("url").trim()
    val sha256 = value.getString("sha256").trim().uppercase()
    val size = value.getLong("size")
    val notes = value.optString("notes").trim()
    require(versionCode > 0 && versionName.isNotBlank()) { "更新清单版本无效" }
    require(sha256.matches(Regex("[0-9A-F]{64}"))) { "更新清单校验值无效" }
    require(size > 0) { "更新包大小无效" }

    val resolved = if (rawUrl.startsWith("/")) {
        val base = URI(baseUrl)
        "${base.scheme}://${base.authority}$rawUrl"
    } else {
        rawUrl
    }
    val uri = URI(resolved)
    val trusted = URI(baseUrl)
    val sameOrigin = uri.host == trusted.host && uri.port == trusted.port
    val officialModelScope = uri.host == "www.modelscope.cn" &&
        uri.path.startsWith("/models/sjw712/POIO/resolve/master/")
    require(uri.scheme == "https" && (sameOrigin || officialModelScope)) {
        "更新地址不是 POIO 官方地址"
    }
    return AndroidUpdateInfo(versionCode, versionName, resolved, sha256, size, notes)
}

class AndroidUpdateManager(
    context: Context,
    private val scope: CoroutineScope,
    private val checker: AndroidUpdateChecker = AndroidUpdateChecker(),
) {
    private val appContext = context.applicationContext
    private val downloadManager = appContext.getSystemService(DownloadManager::class.java)
    private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val mutableState = MutableStateFlow<AndroidUpdateState>(AndroidUpdateState.Idle)
    val state: StateFlow<AndroidUpdateState> = mutableState.asStateFlow()
    private var started = false
    private var closed = false
    private var progressJob: Job? = null
    private val inspectionMutex = Mutex()

    private val completionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            val pending = readPendingDownload() ?: return
            if (completedId != pending.id) return
            scope.launch { inspectDownload(pending) }
        }
    }

    fun start() {
        if (started || closed) return
        started = true
        ContextCompat.registerReceiver(
            appContext,
            completionReceiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            // DownloadManager runs in a separate system package, so this
            // dynamic receiver must accept its completion broadcast. A spoofed
            // ID cannot bypass our query, hash, package-name or version checks.
            ContextCompat.RECEIVER_EXPORTED,
        )
        scope.launch {
            val recovered = recoverPendingDownload()
            if (!recovered) checkForUpdates()
        }
    }

    fun checkForUpdates() {
        if (closed || mutableState.value is AndroidUpdateState.Checking) return
        if (mutableState.value is AndroidUpdateState.Downloading ||
            mutableState.value is AndroidUpdateState.Verifying ||
            mutableState.value is AndroidUpdateState.ReadyToInstall
        ) {
            return
        }
        mutableState.value = AndroidUpdateState.Checking
        scope.launch { mutableState.value = checker.check() }
    }

    fun download(info: AndroidUpdateInfo) {
        if (closed) return
        scope.launch(Dispatchers.IO) {
            runCatching {
                require(info.versionCode > BuildConfig.VERSION_CODE) { "更新版本必须高于当前版本" }
                clearPendingDownload(removeFromManager = true, deleteFile = true)
                val destination = updateFile(info)
                destination.parentFile?.mkdirs()
                if (destination.exists() && !destination.delete()) {
                    error("无法清理旧的更新安装包")
                }
                val request = DownloadManager.Request(Uri.parse(info.url))
                    .setTitle("POIO ${info.versionName}")
                    .setDescription("下载完成后将自动校验并打开安装页面")
                    .setMimeType(APK_MIME_TYPE)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(false)
                    .setDestinationInExternalFilesDir(
                        appContext,
                        Environment.DIRECTORY_DOWNLOADS,
                        destination.name,
                    )
                val id = downloadManager.enqueue(request)
                val pending = PendingDownload(id, info)
                writePendingDownload(pending)
                mutableState.value = AndroidUpdateState.Downloading(info)
                startProgressPolling(pending)
            }.onFailure { error ->
                mutableState.value = AndroidUpdateState.Failed(error.message ?: "无法开始下载更新")
            }
        }
    }

    fun installReadyUpdate() {
        val ready = mutableState.value as? AndroidUpdateState.ReadyToInstall ?: return
        scope.launch { launchInstaller(ready.info) }
    }

    fun close() {
        if (closed) return
        closed = true
        progressJob?.cancel()
        progressJob = null
        if (started) runCatching { appContext.unregisterReceiver(completionReceiver) }
    }

    private suspend fun recoverPendingDownload(): Boolean {
        val pending = readPendingDownload() ?: return false
        if (pending.info.versionCode <= BuildConfig.VERSION_CODE) {
            clearPendingDownload(removeFromManager = true, deleteFile = true)
            return false
        }
        inspectDownload(pending)
        return true
    }

    private suspend fun inspectDownload(pending: PendingDownload) = inspectionMutex.withLock {
        val ready = mutableState.value as? AndroidUpdateState.ReadyToInstall
        if (ready?.info?.versionCode == pending.info.versionCode) return@withLock
        withContext(Dispatchers.IO) {
            val cursor = downloadManager.query(DownloadManager.Query().setFilterById(pending.id))
            cursor.use {
                if (!it.moveToFirst()) {
                    progressJob?.cancel()
                    clearPendingDownload(removeFromManager = false, deleteFile = true)
                    mutableState.value = AndroidUpdateState.Failed("系统下载记录不存在，请重新下载")
                    return@withContext
                }
                when (it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        progressJob?.cancel()
                        verifyDownloadedUpdate(pending.info)
                    }
                    DownloadManager.STATUS_FAILED -> {
                        progressJob?.cancel()
                        val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                        clearPendingDownload(removeFromManager = false, deleteFile = true)
                        mutableState.value = AndroidUpdateState.Failed(downloadFailureMessage(reason))
                    }
                    DownloadManager.STATUS_PAUSED,
                    DownloadManager.STATUS_PENDING,
                    DownloadManager.STATUS_RUNNING,
                    -> {
                        mutableState.value = AndroidUpdateState.Downloading(
                            info = pending.info,
                            downloadedBytes = downloadedBytes(it),
                            totalBytes = totalBytes(it, pending.info.size),
                        )
                        startProgressPolling(pending)
                    }
                    else -> mutableState.value = AndroidUpdateState.Failed("无法识别系统下载状态")
                }
            }
        }
    }

    private fun startProgressPolling(pending: PendingDownload) {
        progressJob?.cancel()
        progressJob = scope.launch(Dispatchers.IO) {
            while (isActive && !closed) {
                val shouldInspect = runCatching {
                    val cursor = downloadManager.query(DownloadManager.Query().setFilterById(pending.id))
                    cursor.use {
                        if (!it.moveToFirst()) return@runCatching true
                        when (it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                            DownloadManager.STATUS_PAUSED,
                            DownloadManager.STATUS_PENDING,
                            DownloadManager.STATUS_RUNNING,
                            -> {
                                mutableState.value = AndroidUpdateState.Downloading(
                                    info = pending.info,
                                    downloadedBytes = downloadedBytes(it),
                                    totalBytes = totalBytes(it, pending.info.size),
                                )
                                false
                            }
                            else -> true
                        }
                    }
                }.getOrElse { true }
                if (shouldInspect) {
                    inspectDownload(pending)
                    return@launch
                }
                delay(PROGRESS_POLL_MILLIS)
            }
        }
    }

    private fun downloadedBytes(cursor: android.database.Cursor): Long =
        cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            .coerceAtLeast(0L)

    private fun totalBytes(cursor: android.database.Cursor, manifestSize: Long): Long =
        cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            .takeIf { it > 0L }
            ?: manifestSize

    private suspend fun verifyDownloadedUpdate(info: AndroidUpdateInfo) {
        mutableState.value = AndroidUpdateState.Verifying(info)
        runCatching {
            val file = updateFile(info)
            check(file.isFile) { "下载完成，但找不到更新安装包" }
            val actualHash = file.inputStream().buffered().use(::sha256Hex)
            val archive = packageArchiveInfo(file)
                ?: error("下载文件不是有效的 Android 安装包")
            validateDownloadedUpdate(
                expectedSize = info.size,
                expectedSha256 = info.sha256,
                expectedPackageName = BuildConfig.APPLICATION_ID,
                expectedVersionCode = info.versionCode.toLong(),
                actualSize = file.length(),
                actualSha256 = actualHash,
                actualPackageName = archive.packageName,
                actualVersionCode = PackageInfoCompat.getLongVersionCode(archive),
            )
        }.onSuccess {
            mutableState.value = AndroidUpdateState.ReadyToInstall(info)
        }.onFailure { error ->
            clearPendingDownload(removeFromManager = true, deleteFile = true)
            mutableState.value = AndroidUpdateState.Failed(error.message ?: "更新安装包校验失败")
        }
    }

    private fun launchInstaller(info: AndroidUpdateInfo) {
        runCatching {
            val file = updateFile(info)
            check(file.isFile) { "更新安装包已经被系统清理，请重新下载" }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !appContext.packageManager.canRequestPackageInstalls()
            ) {
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${BuildConfig.APPLICATION_ID}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                appContext.startActivity(settingsIntent)
                return
            }
            val uri = FileProvider.getUriForFile(
                appContext,
                "${BuildConfig.APPLICATION_ID}.updates",
                file,
            )
            val installIntent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME_TYPE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            appContext.startActivity(installIntent)
        }.onFailure { error ->
            mutableState.value = AndroidUpdateState.Failed(error.message ?: "无法打开系统安装页面")
        }
    }

    @Suppress("DEPRECATION")
    private fun packageArchiveInfo(file: File) =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.PackageInfoFlags.of(0),
            )
        } else {
            appContext.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
        }

    private fun updateFile(info: AndroidUpdateInfo): File {
        val directory = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: error("设备没有可用的应用下载目录")
        return File(directory, "POIO-update-${info.versionCode}.apk")
    }

    private fun writePendingDownload(pending: PendingDownload) {
        val value = JSONObject()
            .put("versionCode", pending.info.versionCode)
            .put("versionName", pending.info.versionName)
            .put("url", pending.info.url)
            .put("sha256", pending.info.sha256)
            .put("size", pending.info.size)
            .put("notes", pending.info.notes)
        preferences.edit()
            .putLong(KEY_DOWNLOAD_ID, pending.id)
            .putString(KEY_UPDATE_INFO, value.toString())
            .apply()
    }

    private fun readPendingDownload(): PendingDownload? = runCatching {
        val id = preferences.getLong(KEY_DOWNLOAD_ID, -1L)
        val raw = preferences.getString(KEY_UPDATE_INFO, null)
        if (id <= 0L || raw.isNullOrBlank()) return@runCatching null
        PendingDownload(id, parseAndroidUpdate(JSONObject(raw), BuildConfig.POIO_SERVER_URL))
    }.getOrNull()

    private fun clearPendingDownload(removeFromManager: Boolean, deleteFile: Boolean) {
        val pending = readPendingDownload()
        if (removeFromManager && pending != null) runCatching { downloadManager.remove(pending.id) }
        if (deleteFile && pending != null) runCatching { updateFile(pending.info).delete() }
        preferences.edit().remove(KEY_DOWNLOAD_ID).remove(KEY_UPDATE_INFO).apply()
    }

    private data class PendingDownload(val id: Long, val info: AndroidUpdateInfo)

    private companion object {
        const val PREFERENCES_NAME = "android_update"
        const val KEY_DOWNLOAD_ID = "download_id"
        const val KEY_UPDATE_INFO = "update_info"
        const val APK_MIME_TYPE = "application/vnd.android.package-archive"
        const val PROGRESS_POLL_MILLIS = 750L
    }
}

internal fun sha256Hex(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (count > 0) digest.update(buffer, 0, count)
    }
    return digest.digest().joinToString("") { "%02X".format(it) }
}

internal fun validateDownloadedUpdate(
    expectedSize: Long,
    expectedSha256: String,
    expectedPackageName: String,
    expectedVersionCode: Long,
    actualSize: Long,
    actualSha256: String,
    actualPackageName: String,
    actualVersionCode: Long,
) {
    require(actualSize == expectedSize) { "更新安装包大小不正确，请重新下载" }
    require(actualSha256.equals(expectedSha256, ignoreCase = true)) {
        "更新安装包 SHA-256 校验失败，请重新下载"
    }
    require(actualPackageName == expectedPackageName) { "更新安装包的应用标识不正确" }
    require(actualVersionCode == expectedVersionCode) { "更新安装包版本与更新清单不一致" }
}

internal fun downloadFailureMessage(reason: Int): String = when (reason) {
    DownloadManager.ERROR_CANNOT_RESUME -> "更新下载无法继续，请重新下载"
    DownloadManager.ERROR_DEVICE_NOT_FOUND -> "找不到可用存储空间"
    DownloadManager.ERROR_FILE_ALREADY_EXISTS -> "更新文件已存在，请重新下载"
    DownloadManager.ERROR_FILE_ERROR -> "无法保存更新安装包"
    DownloadManager.ERROR_HTTP_DATA_ERROR -> "下载更新时网络数据异常"
    DownloadManager.ERROR_INSUFFICIENT_SPACE -> "存储空间不足，无法下载更新"
    DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "更新下载地址重定向次数过多"
    DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "更新服务器返回了不支持的状态"
    DownloadManager.ERROR_UNKNOWN -> "更新下载失败，请重试"
    else -> "更新下载失败（错误码 $reason）"
}

internal fun updateProgressPercent(downloadedBytes: Long, totalBytes: Long): Int? {
    if (totalBytes <= 0L) return null
    return ((downloadedBytes.coerceIn(0L, totalBytes) * 100L) / totalBytes).toInt()
}
