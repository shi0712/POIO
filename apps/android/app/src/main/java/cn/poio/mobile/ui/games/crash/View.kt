package cn.poio.mobile.ui.games.crash

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

@Composable
fun CrashView(game: CrashGame?, wager: Long, busy: Boolean, onWager: (Long) -> Unit, spaceId: String, actions: PoioActions) {
    val phase = game?.phase ?: "betting"; val multiplier = game?.multiplier ?: 1.0
    GameScaffold("Crash", R.drawable.poio_game_crash, GameLime, controls = {
        WagerControl(wager, phase == "betting" && game?.myBet == null && !busy, onWager)
        if (phase == "betting") Button({ actions.placeCrashBet(spaceId, wager) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy && game?.myBet == null) { Icon(Icons.Default.RocketLaunch, null); Spacer(Modifier.width(6.dp)); Text(if (game?.myBet == null) "加入本轮" else "已下注") }
        else if (phase == "running" && game?.myBet?.status == "playing") Button({ actions.cashoutCrash(spaceId) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = GameLime, contentColor = Color.Black)) { Text("结算 ${points((game.myBet.wager * multiplier).toLong())}") }
        else OutlinedButton({}, Modifier.fillMaxWidth().height(50.dp), enabled = false) { Text(if (phase == "crashed") "等待下一轮" else "观看本轮") }
    }) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Color(0xFF11151D)).padding(15.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.fillMaxWidth().height(230.dp)) {
                CrashChart(multiplier, phase, Modifier.fillMaxSize())
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.FlightTakeoff, null, tint = if (phase == "crashed") Color(0xFFFF657B) else GameLime, modifier = Modifier.size(35.dp))
                    Text("${multiplier.format(2)}×", fontSize = 42.sp, fontWeight = FontWeight.Black, color = if (phase == "crashed") Color(0xFFFF657B) else Color.White)
                    Text(if (phase == "betting") "等待下注" else if (phase == "running") "火箭正在加速" else "本轮已爆点", color = Color(0xFF898D9D), fontSize = 10.sp)
                }
            }
            game?.bets.orEmpty().take(5).forEach { bet -> Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color.White.copy(alpha = .04f)).padding(9.dp)) { Text(bet.username, Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(points(bet.wager), color = Color(0xFF8C90A0)); Spacer(Modifier.width(8.dp)); Text(if (bet.status == "cashed") "${bet.cashoutMultiplier?.format(2)}×" else if (bet.status == "lost") "爆点" else "飞行中", color = if (bet.status == "lost") Color(0xFFFF657B) else GameMint) } }
        }
    }
}
@Composable
private fun CrashChart(multiplier: Double, phase: String, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val grid = Color.White.copy(alpha = .05f)
        repeat(6) { index -> drawLine(grid, Offset(0f, size.height * index / 5), Offset(size.width, size.height * index / 5)) }
        repeat(7) { index -> drawLine(grid, Offset(size.width * index / 6, 0f), Offset(size.width * index / 6, size.height)) }
        val heightRatio = (ln(max(1.0, multiplier)) / ln(8.0)).coerceIn(0.02, .94).toFloat()
        val path = Path().apply {
            moveTo(0f, size.height * .9f)
            cubicTo(size.width * .45f, size.height * .9f, size.width * .72f, size.height * (1f - heightRatio * .5f), size.width, size.height * (1f - heightRatio))
        }
        drawPath(path, Brush.horizontalGradient(listOf(GamePurple, if (phase == "crashed") Color(0xFFFF657B) else GameLime)), style = Stroke(width = 7f))
    }
}
