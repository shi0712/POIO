package cn.poio.mobile.ui.games.blackjack

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
fun BlackjackView(game: BlackjackGame?, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions) {
    val playing = game?.status == "playing"
    GameScaffold("21 点", R.drawable.poio_game_blackjack, Color(0xFF9D7CFF), controls = {
        WagerControl(wager, !playing && !busy, onWager)
        if (!playing) Button({ actions.startBlackjack(wager) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy) { Icon(Icons.Default.Casino, null); Spacer(Modifier.width(7.dp)); Text("发牌") }
        else Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Button({ actions.blackjackAction("hit") }, Modifier.weight(1f), enabled = !busy) { Text("要牌") }
            OutlinedButton({ actions.blackjackAction("stand") }, Modifier.weight(1f), enabled = !busy) { Text("停牌") }
            OutlinedButton({ actions.blackjackAction("double") }, Modifier.weight(1f), enabled = !busy && game.canDouble) { Text("加倍") }
        }
    }) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Brush.radialGradient(listOf(Color(0xFF205044), Color(0xFF0F2422)))).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            CardHand("庄家", game?.dealerScore, game?.dealer.orEmpty())
            if (game != null && !playing) Text(game.outcome ?: "本局结束", Modifier.fillMaxWidth(), textAlign = TextAlign.Center, fontWeight = FontWeight.Black, color = if (game.status == "won") GameMint else Color.White)
            CardHand("你", game?.playerScore, game?.player.orEmpty())
        }
    }
}
@Composable
private fun CardHand(label: String, score: Int?, cards: List<GameCard>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f), color = Color(0xFFAFC9C2), fontSize = 10.sp); score?.let { Text(it.toString(), fontWeight = FontWeight.Black) } }
        Row(horizontalArrangement = Arrangement.spacedBy((-16).dp)) {
            cards.ifEmpty { listOf(GameCard(hidden = true), GameCard(hidden = true)) }.forEach { card -> PlayingCard(card) }
        }
    }
}
@Composable
private fun PlayingCard(card: GameCard) {
    val symbol = when (card.suit) { "hearts" -> "♥"; "diamonds" -> "♦"; "clubs" -> "♣"; else -> "♠" }
    val red = card.suit == "hearts" || card.suit == "diamonds"
    Box(
        Modifier.width(68.dp).height(96.dp).shadow(8.dp, RoundedCornerShape(9.dp)).clip(RoundedCornerShape(9.dp))
            .background(if (card.hidden) Brush.linearGradient(listOf(GamePurple, Color(0xFF382081))) else Brush.linearGradient(listOf(Color(0xFFFAF9F4), Color(0xFFE4E2DC))))
            .border(3.dp, if (card.hidden) Color.White.copy(alpha = .7f) else Color.Transparent, RoundedCornerShape(9.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (card.hidden) Text("P", fontSize = 29.sp, fontWeight = FontWeight.Black, color = Color.White)
        else {
            Text(symbol, fontSize = 32.sp, color = if (red) Color(0xFFE84F64) else Color(0xFF151820))
            Column(Modifier.align(Alignment.TopStart).padding(6.dp)) {
                Text(card.rank.orEmpty(), color = if (red) Color(0xFFE84F64) else Color(0xFF151820), fontWeight = FontWeight.Black, lineHeight = 12.sp)
                Text(symbol, color = if (red) Color(0xFFE84F64) else Color(0xFF151820), lineHeight = 12.sp)
            }
        }
    }
}
