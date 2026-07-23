package cn.poio.mobile.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import cn.poio.mobile.MainActivity
import cn.poio.mobile.PoioApplication
import cn.poio.mobile.R

class VoiceForegroundService : Service() {
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "POIO 语音通话", NotificationManager.IMPORTANCE_LOW).apply {
                description = "在后台保持 Mumble 语音频道连接"
                setShowBadge(false)
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val application = application as PoioApplication
        val connected = application.voiceEngine.state.value as? VoiceState.Connected
        when (intent?.action) {
            ACTION_TOGGLE_MUTE -> {
                if (connected == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                startForegroundCompat(buildNotification(this, connected.channelName, connected.muted))
                application.toggleMuteFromNotification()
                return START_NOT_STICKY
            }
            ACTION_LEAVE -> {
                application.leaveVoiceFromNotification()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
        }
        val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty().ifBlank { "语音频道" }
        val muted = intent?.getBooleanExtra(EXTRA_MUTED, connected?.muted ?: false) ?: false
        startForegroundCompat(buildNotification(this, channelName, muted))
        return START_NOT_STICKY
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "poio_voice"
        private const val NOTIFICATION_ID = 712
        private const val EXTRA_CHANNEL_NAME = "channel_name"
        private const val EXTRA_MUTED = "muted"
        private const val ACTION_TOGGLE_MUTE = "cn.poio.mobile.voice.TOGGLE_MUTE"
        private const val ACTION_LEAVE = "cn.poio.mobile.voice.LEAVE"

        fun start(context: Context, channelName: String, muted: Boolean) {
            val intent = Intent(context, VoiceForegroundService::class.java)
                .putExtra(EXTRA_CHANNEL_NAME, channelName)
                .putExtra(EXTRA_MUTED, muted)
            context.startForegroundService(intent)
        }

        fun update(context: Context, channelName: String, muted: Boolean) {
            context.getSystemService(NotificationManager::class.java)
                .notify(NOTIFICATION_ID, buildNotification(context, channelName, muted))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, VoiceForegroundService::class.java))
        }

        private fun buildNotification(context: Context, channelName: String, muted: Boolean): Notification {
            val openApp = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val toggleMute = PendingIntent.getService(
                context,
                1,
                Intent(context, VoiceForegroundService::class.java).setAction(ACTION_TOGGLE_MUTE),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val leave = PendingIntent.getService(
                context,
                2,
                Intent(context, VoiceForegroundService::class.java).setAction(ACTION_LEAVE),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            return Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_poio_voice)
                .setContentTitle("正在使用 POIO 语音")
                .setContentText("已连接：$channelName")
                .setContentIntent(openApp)
                .addAction(
                    Notification.Action.Builder(
                        Icon.createWithResource(context, R.drawable.ic_poio_voice),
                        if (muted) "打开麦克风" else "闭麦",
                        toggleMute,
                    ).build(),
                )
                .addAction(
                    Notification.Action.Builder(
                        Icon.createWithResource(context, R.drawable.ic_poio_voice),
                        "退出语音",
                        leave,
                    ).build(),
                )
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_CALL)
                .build()
        }
    }
}

internal fun nextNotificationMuteState(state: VoiceState): Boolean? =
    (state as? VoiceState.Connected)?.let { !it.muted }
