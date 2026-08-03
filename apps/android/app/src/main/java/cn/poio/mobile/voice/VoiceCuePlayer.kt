package cn.poio.mobile.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import cn.poio.mobile.BuildConfig
import cn.poio.mobile.R
import java.util.EnumMap

enum class VoiceCue { JOIN, LEAVE, MUTE, UNMUTE, DEAFEN, UNDEAFEN }

class VoiceCuePlayer(context: Context) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val lastPlayedAt = EnumMap<VoiceCue, Long>(VoiceCue::class.java)
    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    private var activePlayer: MediaPlayer? = null

    fun playJoin(customPath: String? = null) = enqueue(
        cue = VoiceCue.JOIN,
        resourceId = R.raw.user_join,
        volume = .68f,
        customUrl = customPath?.let(::poioAssetUrl),
    )

    fun playLeave() = enqueue(VoiceCue.LEAVE, R.raw.user_leave, .68f)
    fun playMute() = enqueue(VoiceCue.MUTE, R.raw.mkf_mute, .62f)
    fun playUnmute() = enqueue(VoiceCue.UNMUTE, R.raw.mkf_cancel_mute, .62f)
    fun playDeafen() = enqueue(VoiceCue.DEAFEN, R.raw.head_mute, .62f)
    fun playUndeafen() = enqueue(VoiceCue.UNDEAFEN, R.raw.cancel_head_mute, .62f)

    fun close() {
        mainHandler.post { releaseActivePlayer() }
    }

    private fun enqueue(
        cue: VoiceCue,
        resourceId: Int,
        volume: Float,
        customUrl: String? = null,
    ) {
        mainHandler.post {
            val now = SystemClock.elapsedRealtime()
            if (now - (lastPlayedAt[cue] ?: 0L) < MIN_CUE_INTERVAL_MS) return@post
            lastPlayedAt[cue] = now
            releaseActivePlayer()
            if (customUrl != null) playRemote(customUrl, resourceId, volume)
            else playResource(resourceId, volume)
        }
    }

    private fun playResource(resourceId: Int, volume: Float) {
        val player = MediaPlayer.create(
            appContext,
            resourceId,
            audioAttributes,
            AudioManager.AUDIO_SESSION_ID_GENERATE,
        ) ?: return
        activePlayer = player
        player.setVolume(volume, volume)
        player.setOnCompletionListener(::releaseIfActive)
        player.setOnErrorListener { failed, _, _ ->
            releaseIfActive(failed)
            true
        }
        player.start()
    }

    private fun playRemote(url: String, fallbackResourceId: Int, volume: Float) {
        val player = MediaPlayer()
        activePlayer = player
        player.setAudioAttributes(audioAttributes)
        player.setVolume(volume, volume)
        player.setOnPreparedListener { prepared ->
            if (activePlayer === prepared) prepared.start() else runCatching { prepared.release() }
        }
        player.setOnCompletionListener(::releaseIfActive)
        player.setOnErrorListener { failed, _, _ ->
            releaseIfActive(failed)
            mainHandler.post { playResource(fallbackResourceId, volume) }
            true
        }
        runCatching {
            player.setDataSource(url)
            player.prepareAsync()
        }.onFailure {
            releaseIfActive(player)
            playResource(fallbackResourceId, volume)
        }
    }

    private fun releaseIfActive(player: MediaPlayer) {
        if (activePlayer === player) activePlayer = null
        runCatching { player.stop() }
        runCatching { player.reset() }
        runCatching { player.release() }
    }

    private fun releaseActivePlayer() {
        activePlayer?.let(::releaseIfActive)
        activePlayer = null
    }

    private fun poioAssetUrl(path: String): String =
        if (path.startsWith("http://") || path.startsWith("https://")) path
        else BuildConfig.POIO_SERVER_URL.trimEnd('/') + "/" + path.trimStart('/')

    companion object {
        private const val MIN_CUE_INTERVAL_MS = 350L
    }
}
