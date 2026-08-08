package cn.poio.mobile.ui.games.slots

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
fun SlotsView(spin: SlotSpin?, freeSpins: Int, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions) {
    val fallback = listOf(listOf("duck", "gem", "bolt"), listOf("star", "crown", "duck"), listOf("gem", "wild", "star"), listOf("bolt", "duck", "crown"), listOf("star", "gem", "scatter"))
    val grid = spin?.grid?.takeIf { it.size == 5 } ?: fallback
    GameScaffold("霓虹转轴", R.drawable.poio_game_slots, GamePink, controls = {
        WagerControl(wager, !busy, onWager)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("免费旋转 $freeSpins", color = GamePink); Text(if ((spin?.payout ?: 0) > 0) "+${points(spin?.payout ?: 0)}" else "等待旋转", fontWeight = FontWeight.Black, color = Color(0xFFFFD36B)) }
        Button({ actions.spinSlots(wager, freeSpins > 0) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = GamePink)) { Icon(Icons.Default.Casino, null); Spacer(Modifier.width(7.dp)); Text(if (freeSpins > 0) "免费旋转" else "旋转") }
    }) {
        Row(Modifier.fillMaxWidth().height(276.dp).clip(RoundedCornerShape(20.dp)).background(Color(0xFF201529)).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            grid.forEach { reel -> Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) { reel.take(3).forEach { symbol -> SlotSymbol(symbol, Modifier.weight(1f).fillMaxWidth()) } } }
        }
    }
}

@Composable
private fun SlotSymbol(symbol: String, modifier: Modifier) {
    val label = when (symbol) { "duck" -> "●"; "gem" -> "◆"; "bolt" -> "ϟ"; "crown" -> "♛"; "star" -> "★"; "wild" -> "W"; else -> "✦" }
    val color = when (symbol) { "duck" -> Color(0xFFFFD75B); "gem" -> Color(0xFF6DB8FF); "bolt" -> GameMint; "crown" -> GamePink; "star" -> Color(0xFFA991FF); "wild" -> Color.White; else -> Color(0xFFFFD36B) }
    Box(modifier.clip(RoundedCornerShape(9.dp)).background(if (symbol == "wild") GamePurple else Color(0xFF242132)).border(1.dp, Color.White.copy(alpha = .07f), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
        Text(label, color = color, fontSize = 25.sp, fontWeight = FontWeight.Black)
    }
}
