package cn.poio.mobile.ui.games.mines

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
fun MinesView(game: MinesGame?, wager: Long, mineCount: Int, busy: Boolean, onWager: (Long) -> Unit, onMines: (Int) -> Unit, actions: PoioActions) {
    val playing = game?.status == "playing"
    val revealed = game?.revealed.orEmpty().toSet(); val mines = game?.mines.orEmpty().toSet()
    GameScaffold("Mines", R.drawable.poio_game_mines, GameMint, controls = {
        WagerControl(wager, !playing && !busy, onWager)
        Text("地雷数量", color = Color(0xFF8B8F9F), fontSize = 10.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { listOf(3, 5, 8, 12).forEach { count -> OutlinedButton({ onMines(count) }, enabled = !playing, colors = ButtonDefaults.outlinedButtonColors(containerColor = if (mineCount == count) GameMint.copy(alpha = .15f) else Color.Transparent)) { Text(count.toString()) } } }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("倍率 ${(game?.multiplier ?: 1.0).format(2)}×", color = GameMint); Text("安全 ${game?.revealed?.size ?: 0}/${25 - (game?.mineCount ?: mineCount)}") }
        if (!playing) Button({ actions.startMines(wager, mineCount) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy) { Text("开始") }
        else Button(actions::cashoutMines, Modifier.fillMaxWidth().height(50.dp), enabled = !busy && revealed.isNotEmpty(), colors = ButtonDefaults.buttonColors(containerColor = GameLime, contentColor = Color(0xFF11131A))) { Text("结算 ${points(game.nextPayout)}") }
    }) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Color(0xFF102329)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(5) { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                repeat(5) { column ->
                    val cell = row * 5 + column; val open = cell in revealed; val mine = cell in mines
                    Box(
                        Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(10.dp))
                            .background(if (mine) Color(0xFF4B1D2A) else if (open) Color(0xFF17433C) else Color(0xFF213841))
                            .clickable(enabled = playing && !busy && !open) { actions.revealMine(cell) },
                        contentAlignment = Alignment.Center,
                    ) {
                        when { mine -> Icon(Icons.Default.Bolt, null, tint = Color(0xFFFF6179)); open -> Icon(Icons.Default.Diamond, null, tint = Color(0xFF66F1DD)); else -> Text("${cell + 1}", color = Color(0xFF52757B), fontSize = 8.sp) }
                    }
                }
            } }
            AnimatedVisibility(game != null && !playing) { Text(game?.outcome.orEmpty(), Modifier.fillMaxWidth().padding(9.dp), textAlign = TextAlign.Center, fontWeight = FontWeight.Black) }
        }
    }
}
