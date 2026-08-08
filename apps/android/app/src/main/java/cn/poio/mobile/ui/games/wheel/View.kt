package cn.poio.mobile.ui.games.wheel

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.FlightTakeoff
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.RocketLaunch
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.poio.mobile.PoioActions
import cn.poio.mobile.R
import cn.poio.mobile.model.BlackjackGame
import cn.poio.mobile.model.CrashGame
import cn.poio.mobile.model.GameCard
import cn.poio.mobile.model.GameCenterState
import cn.poio.mobile.model.GomokuGame
import cn.poio.mobile.model.GomokuRoom
import cn.poio.mobile.model.MinesGame
import cn.poio.mobile.model.SlotSpin
import cn.poio.mobile.model.User
import cn.poio.mobile.model.WheelSpin
import cn.poio.mobile.ui.games.MobileGame
import cn.poio.mobile.ui.games.MobileGameRegistry
import java.text.NumberFormat
import kotlin.math.ln
import kotlin.math.max
import kotlinx.coroutines.delay
import cn.poio.mobile.ui.games.shared.*

private val wheelColors = listOf(0xFFFF5F78,0xFF6F57E8,0xFF2F8DD8,0xFF2AB99F,0xFF87BC45,0xFFE8AF3D,0xFFED7B39,0xFFE3529A,0xFF9B5DE5,0xFFFFD95A).map(::Color)

@Composable
fun WheelView(spin: WheelSpin?, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions) {
    var target by remember { mutableStateOf(0f) }
    androidx.compose.runtime.LaunchedEffect(spin?.id) {
        spin ?: return@LaunchedEffect
        val center = spin.segmentIndex * 36f + 18f
        target += 5 * 360f + ((360f - (center + target % 360f)) % 360f)
    }
    val rotation by animateFloatAsState(target, tween(2800), label = "wheel")
    GameScaffold("幸运大转盘", R.drawable.poio_game_wheel, Color(0xFFFFD85A), controls = {
        WagerControl(wager, !busy, onWager)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("最高 10×", color = Color(0xFFFFD85A)); Text(spin?.let { if (it.payout > 0) "${it.label} · +${points(it.payout)}" else it.label } ?: "等待转动", fontWeight = FontWeight.Black) }
        Button({ actions.spinWheel(wager) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFB33F), contentColor = Color(0xFF241D14))) { Icon(Icons.Default.Casino, null); Spacer(Modifier.width(7.dp)); Text(if (busy) "转动中…" else "转动 · ${points(wager)}") }
    }) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(22.dp)).background(Color(0xFF121321)), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize(.82f).graphicsLayer { rotationZ = rotation }) {
                wheelColors.forEachIndexed { index, color -> drawArc(color, index * 36f - 90f, 36f, true, Offset.Zero, Size(size.width,size.height)) }
                drawCircle(Color(0xFFFFF3C7), size.minDimension * .15f)
                drawCircle(Color(0xFFFFD85A), size.minDimension * .15f, style = Stroke(size.minDimension * .025f))
            }
            Text("POIO", fontWeight = FontWeight.Black, color = Color(0xFF2A2341), fontSize = 20.sp)
            Canvas(Modifier.align(Alignment.TopCenter).padding(top = 12.dp).size(44.dp)) { val path=Path().apply{moveTo(size.width/2,size.height);lineTo(0f,0f);lineTo(size.width,0f);close()};drawPath(path,Color.White) }
        }
    }
}
