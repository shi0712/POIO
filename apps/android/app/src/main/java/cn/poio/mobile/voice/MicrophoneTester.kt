package cn.poio.mobile.voice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.sqrt

sealed interface MicrophoneTestState {
    data object Idle : MicrophoneTestState
    data class Testing(val level: Float, val deviceName: String) : MicrophoneTestState
    data class Failed(val message: String) : MicrophoneTestState
}

class MicrophoneTester(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutableState = MutableStateFlow<MicrophoneTestState>(MicrophoneTestState.Idle)
    val state: StateFlow<MicrophoneTestState> = mutableState.asStateFlow()
    private var testJob: Job? = null

    fun start(deviceId: Int, deviceName: String) {
        stop()
        mutableState.value = MicrophoneTestState.Testing(0f, deviceName)
        testJob = scope.launch { capture(deviceId, deviceName) }
    }

    fun stop() {
        testJob?.cancel()
        testJob = null
        mutableState.value = MicrophoneTestState.Idle
    }

    fun close() {
        stop()
        scope.cancel()
    }

    @SuppressLint("MissingPermission")
    private suspend fun capture(deviceId: Int, deviceName: String) {
        var recorder: AudioRecord? = null
        try {
            val minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            check(minBuffer > 0) { "当前设备不支持 48 kHz 单声道麦克风测试" }
            recorder = AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(maxOf(minBuffer * 2, SAMPLE_BUFFER_SAMPLES * 4))
                .build()
            check(recorder.state == AudioRecord.STATE_INITIALIZED) { "麦克风初始化失败" }

            if (deviceId > 0) {
                val device = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                    .firstOrNull { it.id == deviceId }
                check(device != null && recorder.setPreferredDevice(device)) { "所选麦克风已经断开" }
            }

            recorder.startRecording()
            check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "无法开始麦克风测试" }
            val samples = ShortArray(SAMPLE_BUFFER_SAMPLES)
            var smoothed = 0f
            while (currentCoroutineContext().isActive) {
                val count = recorder.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                if (count < 0) error("读取麦克风失败（$count）")
                if (count > 0) {
                    var energy = 0.0
                    for (index in 0 until count) {
                        val value = samples[index].toDouble()
                        energy += value * value
                    }
                    val rms = sqrt(energy / count) / Short.MAX_VALUE
                    val instantaneous = microphoneMeterLevel(rms)
                    smoothed = if (instantaneous > smoothed) {
                        instantaneous
                    } else {
                        smoothed * LEVEL_DECAY
                    }
                    mutableState.value = MicrophoneTestState.Testing(smoothed, deviceName)
                }
                delay(16)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            mutableState.value = MicrophoneTestState.Failed(error.message ?: "麦克风测试失败")
        } finally {
            recorder?.let {
                runCatching {
                    if (it.recordingState == AudioRecord.RECORDSTATE_RECORDING) it.stop()
                }
                it.release()
            }
        }
    }

    private companion object {
        const val SAMPLE_RATE = 48_000
        const val SAMPLE_BUFFER_SAMPLES = 960
        const val LEVEL_DECAY = 0.82f
    }
}
