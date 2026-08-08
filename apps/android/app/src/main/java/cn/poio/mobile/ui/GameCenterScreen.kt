package cn.poio.mobile.ui

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
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.windowInsetsPadding
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
import cn.poio.mobile.ui.games.blackjack.BlackjackView
import cn.poio.mobile.ui.games.crash.CrashView
import cn.poio.mobile.ui.games.gomoku.GomokuView
import cn.poio.mobile.ui.games.mines.MinesView
import cn.poio.mobile.ui.games.shared.points
import cn.poio.mobile.ui.games.slots.SlotsView
import cn.poio.mobile.ui.games.wheel.WheelView
import cn.poio.mobile.ui.games.texasholdem.TexasHoldemView
import cn.poio.mobile.ui.games.pool.PoolView
import java.text.NumberFormat
import kotlin.math.ln
import kotlin.math.max
import kotlinx.coroutines.delay

private val GameBackground = Color(0xFF0D0F18)
private val GamePanel = Color(0xFF181A27)
private val GamePurple = Color(0xFF795BFF)
private val GameMint = Color(0xFF49DFC7)
private val GameLime = Color(0xFFD6FF5E)
private val GamePink = Color(0xFFFF75BC)

@Composable
fun GameCenterScreen(
    state: GameCenterState,
    spaceId: String,
    onlineMembers: List<User>,
    busy: Boolean,
    actions: PoioActions,
    onBack: () -> Unit,
) {
    var game by remember { mutableStateOf(MobileGame.LOBBY) }
    var wager by remember { mutableLongStateOf(100) }
    var mineCount by remember { mutableIntStateOf(5) }
    var inviteOpen by remember { mutableStateOf(false) }
    var inviteGame by remember { mutableStateOf(MobileGame.GOMOKU) }
    val invitedUntil = remember { mutableStateMapOf<String, Long>() }
    var inviteClock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    androidx.compose.runtime.LaunchedEffect(state.gomoku?.roomId) { invitedUntil.clear(); inviteOpen = false }
    androidx.compose.runtime.LaunchedEffect(state.texas?.roomId) { invitedUntil.clear(); inviteOpen = false }
    androidx.compose.runtime.LaunchedEffect(state.pool?.roomId) { invitedUntil.clear(); inviteOpen = false }
    androidx.compose.runtime.LaunchedEffect(inviteOpen) { while (inviteOpen) { inviteClock = System.currentTimeMillis(); delay(500) } }
    Column(
        Modifier.fillMaxSize().background(GameBackground)
            .windowInsetsPadding(WindowInsets.statusBars.union(WindowInsets.navigationBars)),
    ) {
        GameTopBar(
            balance = state.wallet?.balance ?: 0,
            game = game,
            onBack = { if (game == MobileGame.LOBBY) onBack() else game = MobileGame.LOBBY },
            onClose = onBack,
        )
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = GamePurple)
                    Text("正在进入 POIO 游戏中心", color = Color(0xFF9A9EAE))
                }
            }
            state.wallet == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("游戏中心暂时不可用") }
            game == MobileGame.LOBBY -> GameLobby(state, busy, actions) { game = it }
            game == MobileGame.BLACKJACK -> BlackjackView(state.blackjack, wager, busy, { wager = it }, actions)
            game == MobileGame.MINES -> MinesView(state.mines, wager, mineCount, busy, { wager = it }, { mineCount = it }, actions)
            game == MobileGame.CRASH -> CrashView(state.crash, wager, busy, { wager = it }, spaceId, actions)
            game == MobileGame.SLOTS -> SlotsView(state.slots, state.wallet.freeSpins, wager, busy, { wager = it }, actions)
            game == MobileGame.WHEEL -> WheelView(state.wheel, wager, busy, { wager = it }, actions)
            game == MobileGame.GOMOKU -> GomokuView(state.gomoku, state.gomokuRooms, spaceId, wager, busy, { wager = it }, actions) { inviteGame=MobileGame.GOMOKU;inviteOpen = true }
            game == MobileGame.TEXAS_HOLDEM -> TexasHoldemView(state.texas, state.texasRooms, spaceId, busy, actions) { inviteGame=MobileGame.TEXAS_HOLDEM;inviteOpen = true }
            else -> PoolView(state.pool,state.poolRooms,spaceId,wager,busy,{wager=it},actions){inviteGame=MobileGame.POOL;inviteOpen=true}
        }
    }
    val invitePlayerIds=when(inviteGame){MobileGame.TEXAS_HOLDEM->state.texas?.players?.map{it.id}?.toSet();MobileGame.POOL->state.pool?.players?.map{it.id}?.toSet();else->state.gomoku?.players?.map{it.id}?.toSet()}
    val inviteRoomId=when(inviteGame){MobileGame.TEXAS_HOLDEM->state.texas?.roomId;MobileGame.POOL->state.pool?.roomId;else->state.gomoku?.roomId}
    if (inviteOpen && invitePlayerIds != null && inviteRoomId != null) AlertDialog(
        onDismissRequest = { inviteOpen = false },
        title = { Text("邀请在线成员", fontWeight = FontWeight.Black) },
        text = { LazyColumn(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            val available = onlineMembers.filter { member -> member.id !in invitePlayerIds }
            if (available.isEmpty()) item { Text("暂时没有可邀请的在线成员", color = Color(0xFF8B8E9C)) }
            items(available, key = User::id) { member -> val remaining=((invitedUntil[member.id]?:0L)-inviteClock).coerceAtLeast(0); Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = .04f)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(member.username, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                Button(enabled=remaining<=0,onClick = { when(inviteGame){MobileGame.TEXAS_HOLDEM->actions.inviteTexas(spaceId,inviteRoomId,member.id);MobileGame.POOL->actions.invitePool(spaceId,inviteRoomId,member.id);else->actions.inviteGomoku(spaceId,inviteRoomId,member.id)}; invitedUntil[member.id]=System.currentTimeMillis()+5_000 }) { Icon(Icons.Default.PersonAdd, null); Spacer(Modifier.width(5.dp)); Text(if(remaining>0)"已邀请 ${kotlin.math.ceil(remaining/1000.0).toInt()}s" else if(invitedUntil.containsKey(member.id))"重新邀请" else "邀请") }
            } }
        } },
        confirmButton = { TextButton(onClick = { inviteOpen = false }) { Text("完成") } },
    )
}

@Composable
private fun GameTopBar(balance: Long, game: MobileGame, onBack: () -> Unit, onClose: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(64.dp).background(Color(0xFF11131D)).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
        Column(Modifier.weight(1f)) {
            Text(if (game == MobileGame.LOBBY) "POIO PLAYGROUND" else game.name, fontWeight = FontWeight.Black, fontSize = 15.sp)
            Text("娱乐积分 · 不可充值或兑换", color = Color(0xFF777B8D), fontSize = 9.sp)
        }
        Row(
            Modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFF222431)).padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Paid, null, Modifier.size(17.dp), tint = Color(0xFFFFD36B))
            Spacer(Modifier.width(5.dp))
            Text(points(balance), fontWeight = FontWeight.Black, fontSize = 12.sp)
        }
        IconButton(onClick = onClose) { Icon(Icons.Default.Close, "关闭") }
    }
}

private val mobileGames get() = MobileGameRegistry.games

@Composable
private fun GameLobby(state: GameCenterState, busy: Boolean, actions: PoioActions, onGame: (MobileGame) -> Unit) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(15.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        item {
            Box(Modifier.fillMaxWidth().aspectRatio(1.55f).clip(RoundedCornerShape(22.dp))) {
                Image(painterResource(R.drawable.poio_game_center_hero), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color(0xE80B0D16), Color(0x220B0D16)))))
                Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
                    Text("POIO ORIGINAL GAMES", color = Color(0xFFA993FF), fontSize = 9.sp, fontWeight = FontWeight.Black)
                    Text("和朋友一起\n玩点刺激的", fontSize = 28.sp, lineHeight = 29.sp, fontWeight = FontWeight.Black)
                    Text("同一账号、同一社区、同一积分账本", color = Color(0xFFB4B6C1), fontSize = 11.sp)
                }
            }
        }
        item {
            val ready = state.wallet?.let { it.lastDaily == 0L || System.currentTimeMillis() >= it.nextDailyAt } == true
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(GamePanel).padding(13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.CardGiftcard, null, tint = Color(0xFFFFD36B))
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Text(if (ready) "每日积分已准备" else "今日奖励已领取", fontWeight = FontWeight.Bold)
                    Text(if (ready) "+${points(state.wallet.dailyReward)} 娱乐积分" else "明天再来", color = Color(0xFF85899A), fontSize = 10.sp)
                }
                Button(onClick = actions::claimGameDaily, enabled = ready && !busy) { Text(if (ready) "领取" else "已领取") }
            }
        }
        item { Text("选择一款游戏", fontWeight = FontWeight.Black, fontSize = 20.sp, modifier = Modifier.padding(top = 7.dp)) }
        items(mobileGames, key = { it.game }) { item ->
            Box(
                Modifier.fillMaxWidth().aspectRatio(1.9f).clip(RoundedCornerShape(19.dp))
                    .border(1.dp, item.color.copy(alpha = .35f), RoundedCornerShape(19.dp)).clickable { onGame(item.game) },
            ) {
                Image(painterResource(item.art), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color(0xED11131D), Color(0x4411131D)))))
                Column(Modifier.align(Alignment.BottomStart).padding(17.dp)) {
                    Text(item.game.name, color = item.color, fontSize = 8.sp, fontWeight = FontWeight.Black)
                    Text(item.name, fontSize = 22.sp, fontWeight = FontWeight.Black)
                    Text(item.detail, color = Color(0xFFB2B4BF), fontSize = 10.sp)
                }
                Icon(Icons.Default.SportsEsports, null, Modifier.align(Alignment.BottomEnd).padding(17.dp), tint = item.color)
            }
        }
        item {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFF14221F)).padding(13.dp)) {
                Icon(Icons.Default.Shield, null, tint = GameMint)
                Text("单机结果与联机落子都由服务端判定，双方棋盘始终同步。", Modifier.padding(start = 8.dp), color = Color(0xFF969AA9), fontSize = 10.sp)
            }
        }
    }
}
