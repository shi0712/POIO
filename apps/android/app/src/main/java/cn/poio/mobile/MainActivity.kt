package cn.poio.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cn.poio.mobile.ui.PoioApp
import cn.poio.mobile.ui.theme.PoioTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PoioTheme {
                val model: PoioViewModel = viewModel()
                val state by model.state.collectAsStateWithLifecycle()
                val voiceState by model.voiceState.collectAsStateWithLifecycle()
                val voiceDeviceState by model.voiceDeviceState.collectAsStateWithLifecycle()
                val microphoneTestState by model.microphoneTestState.collectAsStateWithLifecycle()
                val screenState by model.screenState.collectAsStateWithLifecycle()
                val updateState by model.updateState.collectAsStateWithLifecycle()
                PoioApp(
                    state = state,
                    voiceState = voiceState,
                    voiceDeviceState = voiceDeviceState,
                    microphoneTestState = microphoneTestState,
                    screenState = screenState,
                    updateState = updateState,
                    actions = model,
                )
            }
        }
    }
}
