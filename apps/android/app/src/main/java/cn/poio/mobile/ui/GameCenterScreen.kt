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
    val invitedUntil = remember { mutableStateMapOf<String, Long>() }
    var inviteClock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    androidx.compose.runtime.LaunchedEffect(state.gomoku?.roomId) { invitedUntil.clear(); inviteOpen = false }
    androidx.compose.runtime.LaunchedEffect(inviteOpen) { while (inviteOpen) { inviteClock = System.currentTimeMillis(); delay(500) } }
    Column(Modifier.fillMaxSize().background(GameBackground)) {
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
            else -> GomokuView(state.gomoku, state.gomokuRooms, spaceId, wager, busy, { wager = it }, actions) { inviteOpen = true }
        }
    }
    if (inviteOpen && state.gomoku != null) AlertDialog(
        onDismissRequest = { inviteOpen = false },
        title = { Text("邀请在线成员", fontWeight = FontWeight.Black) },
        text = { LazyColumn(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            val available = onlineMembers.filter { member -> state.gomoku.players.none { it.id == member.id } }
            if (available.isEmpty()) item { Text("暂时没有可邀请的在线成员", color = Color(0xFF8B8E9C)) }
            items(available, key = User::id) { member -> val remaining=((invitedUntil[member.id]?:0L)-inviteClock).coerceAtLeast(0); Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = .04f)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(member.username, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                Button(enabled=remaining<=0,onClick = { actions.inviteGomoku(spaceId, state.gomoku.roomId, member.id); invitedUntil[member.id]=System.currentTimeMillis()+5_000 }) { Icon(Icons.Default.PersonAdd, null); Spacer(Modifier.width(5.dp)); Text(if(remaining>0)"已邀请 ${kotlin.math.ceil(remaining/1000.0).toInt()}s" else if(invitedUntil.containsKey(member.id))"重新邀请" else "邀请") }
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

@Composable
private fun GameScaffold(title: String, art: Int, color: Color, controls: @Composable () -> Unit, content: @Composable () -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(108.dp).clip(RoundedCornerShape(18.dp))) {
                Image(painterResource(art), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color(0xE70D0F18), Color.Transparent))))
                Text(title, Modifier.align(Alignment.CenterStart).padding(18.dp), fontSize = 25.sp, fontWeight = FontWeight.Black, color = color)
            }
        }
        item { content() }
        item { Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(GamePanel).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { controls() } }
    }
}

@Composable
private fun WagerControl(value: Long, enabled: Boolean, onValue: (Long) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text("下注积分", color = Color(0xFF8B8F9F), fontSize = 10.sp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { onValue(max(10, value / 2 / 10 * 10)) }, enabled = enabled) { Text("½") }
            Text(points(value), Modifier.weight(1f), textAlign = TextAlign.Center, fontWeight = FontWeight.Black, fontSize = 18.sp)
            OutlinedButton(onClick = { onValue((value * 2).coerceAtMost(1_000_000)) }, enabled = enabled) { Text("2×") }
        }
    }
}

@Composable
private fun BlackjackView(game: BlackjackGame?, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions) {
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

@Composable
private fun MinesView(game: MinesGame?, wager: Long, mineCount: Int, busy: Boolean, onWager: (Long) -> Unit, onMines: (Int) -> Unit, actions: PoioActions) {
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

@Composable
private fun CrashView(game: CrashGame?, wager: Long, busy: Boolean, onWager: (Long) -> Unit, spaceId: String, actions: PoioActions) {
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

@Composable
private fun GomokuView(game: GomokuGame?, rooms: List<GomokuRoom>, spaceId: String, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions, onInvite: () -> Unit) {
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

@Composable
private fun SlotsView(spin: SlotSpin?, freeSpins: Int, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions) {
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

private val wheelColors = listOf(0xFFFF5F78,0xFF6F57E8,0xFF2F8DD8,0xFF2AB99F,0xFF87BC45,0xFFE8AF3D,0xFFED7B39,0xFFE3529A,0xFF9B5DE5,0xFFFFD95A).map(::Color)

@Composable
private fun WheelView(spin: WheelSpin?, wager: Long, busy: Boolean, onWager: (Long) -> Unit, actions: PoioActions) {
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

@Composable
private fun SlotSymbol(symbol: String, modifier: Modifier) {
    val label = when (symbol) { "duck" -> "●"; "gem" -> "◆"; "bolt" -> "ϟ"; "crown" -> "♛"; "star" -> "★"; "wild" -> "W"; else -> "✦" }
    val color = when (symbol) { "duck" -> Color(0xFFFFD75B); "gem" -> Color(0xFF6DB8FF); "bolt" -> GameMint; "crown" -> GamePink; "star" -> Color(0xFFA991FF); "wild" -> Color.White; else -> Color(0xFFFFD36B) }
    Box(modifier.clip(RoundedCornerShape(9.dp)).background(if (symbol == "wild") GamePurple else Color(0xFF242132)).border(1.dp, Color.White.copy(alpha = .07f), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
        Text(label, color = color, fontSize = 25.sp, fontWeight = FontWeight.Black)
    }
}

private fun points(value: Long): String = NumberFormat.getIntegerInstance().format(value)
private fun Double.format(decimals: Int) = "%1.${decimals}f".format(this)
