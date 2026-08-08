package cn.poio.mobile.ui.games.gomoku

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
fun GomokuView(game: GomokuGame?, rooms: List<GomokuRoom>, spaceId: String, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions, onInvite: () -> Unit) {
    if (game == null) {
        GameScaffold("联机五子棋", R.drawable.poio_game_gomoku, Color(0xFFC9A66B), controls = {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color(0xFF211E25)).padding(13.dp)) {
                Text("标准 15 路棋盘", fontWeight = FontWeight.Black)
                Text("黑棋先行，横、竖或斜线连续五子获胜。", color = Color(0xFF9698A5), fontSize = 10.sp)
            }
            WagerControl(wager, !busy, onWager)
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color(0xFF251F18)).padding(11.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("双方奖池", color = Color(0xFF9B8D76)); Text("${points(wager * 2)} 积分", color = Color(0xFFFFD36B), fontWeight = FontWeight.Black)
            }
            Text("双方等额押注 · 胜者获得奖池 · 和棋自动退回", color = Color(0xFF8A8E9D), fontSize = 10.sp)
            Button({ actions.createGomoku(spaceId, wager) }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC9A66B))) {
                Icon(Icons.Default.SportsEsports, null); Spacer(Modifier.width(7.dp)); Text("押 ${points(wager)} 积分创建")
            }
        }) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color(0xFF151722)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth().padding(5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("社区棋桌", Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.Black)
                    Text("${rooms.count { it.status != "finished" }} 桌可加入", color = GameMint, fontSize = 10.sp)
                }
                if (rooms.isEmpty()) Box(Modifier.fillMaxWidth().height(250.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.SportsEsports, null, Modifier.size(38.dp), tint = Color(0xFF6F7280))
                        Spacer(Modifier.height(9.dp)); Text("还没有人摆下棋盘", color = Color(0xFF9B9EAA))
                    }
                } else rooms.forEach { room ->
                    val label = if (room.isMine) "返回" else if (room.status == "waiting") "加入" else "观战"
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color.White.copy(alpha = .04f))
                            .clickable(enabled = !busy) { actions.openGomoku(spaceId, room.roomId, room.isMine || room.status == "waiting") }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(42.dp)) {
                            Box(Modifier.size(28.dp).align(Alignment.TopStart).clip(RoundedCornerShape(50)).background(Color(0xFF101115)))
                            Box(Modifier.size(28.dp).align(Alignment.BottomEnd).clip(RoundedCornerShape(50)).background(Color(0xFFEAE7DE)).border(1.dp, Color.White, RoundedCornerShape(50)))
                        }
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text(room.players.joinToString("  vs  ") { it.username }.ifBlank { "等待玩家" }, fontWeight = FontWeight.Bold, maxLines = 1)
                            Text("每人 ${points(room.wager)} · 第 ${room.roundNumber} 局 · ${if (room.status == "waiting") "等待对手" else if (room.status == "playing") "${room.moveCount} 手" else "已结束"}", color = Color(0xFF777B8B), fontSize = 9.sp)
                        }
                        Text(label, color = Color(0xFFD4B67D), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        return
    }

    val me = game.players.firstOrNull { it.color == game.me }
    val turn = game.players.firstOrNull { it.color == game.currentColor }
    val winner = game.players.firstOrNull { it.id == game.winnerId }
    val headline = when {
        game.status == "waiting" -> "等待另一位玩家加入"
        game.status == "playing" && game.me == "spectator" -> "观战中 · ${turn?.username ?: "玩家"} 落子"
        game.status == "playing" && game.canMove -> "轮到你落子"
        game.status == "playing" -> "等待 ${turn?.username ?: "对手"} 落子"
        game.result == "draw" -> "本局和棋"
        else -> "${winner?.username ?: "玩家"} 获胜"
    }
    GameScaffold("五子棋 · 第 ${game.roundNumber} 局", R.drawable.poio_game_gomoku, Color(0xFFC9A66B), controls = {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFF10121B)).padding(11.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(31.dp).clip(RoundedCornerShape(50)).background(if (game.currentColor == "black") Color(0xFF111216) else Color(0xFFE9E5DC)))
            Column(Modifier.padding(start = 10.dp)) { Text("当前状态", color = Color(0xFF777B8C), fontSize = 8.sp); Text(headline, fontWeight = FontWeight.Black) }
        }
        game.players.forEach { player ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(if (game.currentColor == player.color && game.status == "playing") Color(0x22C9A66B) else Color.White.copy(alpha = .035f)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(29.dp).clip(RoundedCornerShape(50)).background(if (player.color == "black") Color(0xFF111216) else Color(0xFFE9E5DC)).border(1.dp, if (player.color == "white") Color.White else Color.Transparent, RoundedCornerShape(50)))
                Column(Modifier.weight(1f).padding(horizontal = 9.dp)) { Text(player.username, fontWeight = FontWeight.Bold); Text(if (player.color == "black") "黑棋 · 先手" else "白棋 · 后手", color = Color(0xFF7A7E8E), fontSize = 9.sp) }
                if (player.id == me?.id) Text("你", color = GameMint, fontSize = 9.sp)
            }
        }
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFF251F18)).padding(10.dp), horizontalArrangement = Arrangement.SpaceBetween) { Text("本局奖池", color = Color(0xFF9B8D76)); Text("${points(game.pot)} 积分", color = Color(0xFFFFD36B), fontWeight = FontWeight.Black) }
        if (game.status == "waiting" && me != null) Button(onClick = onInvite, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC9A66B))) { Icon(Icons.Default.PersonAdd, null); Spacer(Modifier.width(7.dp)); Text("邀请在线成员") }
        if (game.status == "finished" && me != null) {
            val voted = me.id in game.rematchVotes
            Button({ actions.rematchGomoku(game.roomId) }, Modifier.fillMaxWidth().height(48.dp), enabled = !busy && !voted, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC9A66B))) { Text(if (voted) "等待对手同意" else "再来一局") }
        }
        if (game.status == "playing" && me != null) OutlinedButton({ actions.resignGomoku(game.roomId) }, Modifier.fillMaxWidth(), enabled = !busy) { Text("认输", color = Color(0xFFFF7187)) }
        OutlinedButton({ actions.leaveGomoku(game.roomId) }, Modifier.fillMaxWidth(), enabled = !busy) { Text(if (game.status == "waiting" && me != null) "解散棋桌" else "离开棋桌") }
    }) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color(0xFF211B16)).padding(11.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            GomokuBoard(game, busy) { actions.playGomokuMove(game.roomId, it) }
            Text(headline, Modifier.fillMaxWidth().padding(top = 10.dp), textAlign = TextAlign.Center, color = if (game.status == "finished") GameLime else Color(0xFFB8B5AF), fontWeight = FontWeight.Bold)
        }
    }
}
@Composable
private fun GomokuBoard(game: GomokuGame, busy: Boolean, onMove: (Int) -> Unit) {
    val winning = game.winningLine.toSet()
    Canvas(
        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(9.dp)).background(Color(0xFFC99B59))
            .pointerInput(game.roomId, game.canMove, busy, game.board) {
                detectTapGestures { point ->
                    if (!game.canMove || busy) return@detectTapGestures
                    val padding = size.width * .055f; val step = (size.width - padding * 2f) / 14f
                    val column = ((point.x - padding + step / 2f) / step).toInt().coerceIn(0, 14)
                    val row = ((point.y - padding + step / 2f) / step).toInt().coerceIn(0, 14)
                    val cell = row * 15 + column
                    if (game.board.getOrNull(cell) == null) onMove(cell)
                }
            },
    ) {
        val padding = size.width * .055f; val step = (size.width - padding * 2f) / 14f
        repeat(15) { index ->
            val position = padding + step * index
            drawLine(Color(0xFF604526), Offset(padding, position), Offset(size.width - padding, position), 1.4f)
            drawLine(Color(0xFF604526), Offset(position, padding), Offset(position, size.height - padding), 1.4f)
        }
        listOf(3, 7, 11).forEach { row -> listOf(3, 7, 11).forEach { column -> drawCircle(Color(0xFF604526), step * .09f, Offset(padding + column * step, padding + row * step)) } }
        game.board.forEachIndexed { cell, stone ->
            if (stone == null) return@forEachIndexed
            val center = Offset(padding + (cell % 15) * step, padding + (cell / 15) * step)
            drawCircle(Color.Black.copy(alpha = .25f), step * .43f, center + Offset(0f, step * .08f))
            drawCircle(if (stone == "black") Color(0xFF111216) else Color(0xFFECE8DF), step * .42f, center)
            drawCircle(if (stone == "black") Color(0xFF5A5B60) else Color.White.copy(alpha = .9f), step * .13f, center - Offset(step * .12f, step * .13f))
            if (cell == game.lastMove) drawCircle(Color(0xFFFF5F78), step * .095f, center)
            if (cell in winning) drawCircle(GameLime, step * .48f, center, style = Stroke(width = step * .08f))
        }
    }
}
