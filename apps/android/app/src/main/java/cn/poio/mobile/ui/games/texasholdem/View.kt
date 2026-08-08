package cn.poio.mobile.ui.games.texasholdem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.poio.mobile.PoioActions
import cn.poio.mobile.R
import cn.poio.mobile.model.GameCard
import cn.poio.mobile.model.TexasGame
import cn.poio.mobile.model.TexasPlayer
import cn.poio.mobile.model.TexasRoom
import cn.poio.mobile.ui.games.shared.GameScaffold
import cn.poio.mobile.ui.games.shared.WagerControl
import cn.poio.mobile.ui.games.shared.points

private val Gold=Color(0xFFF0B85A)
private val Felt=Color(0xFF16483D)

@Composable
fun TexasHoldemView(game: TexasGame?, rooms: List<TexasRoom>, spaceId: String, busy: Boolean, actions: PoioActions, onInvite: () -> Unit) {
    var smallBlind by remember { mutableLongStateOf(20) }; var buyIn by remember { mutableLongStateOf(1000) }; var maxPlayers by remember { mutableIntStateOf(6) }
    if (game == null) {
        GameScaffold("德州扑克", R.drawable.poio_game_texas, Gold, controls = {
            Text("小盲积分", color = Color(0xFF8D919F), fontSize = 10.sp); WagerControl(smallBlind, !busy) { smallBlind=it; if(buyIn<it*20)buyIn=it*20 }
            Text("带入筹码（至少 20 个小盲）", color = Color(0xFF8D919F), fontSize = 10.sp); WagerControl(buyIn, !busy, { buyIn=it.coerceAtLeast(smallBlind*20) })
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) { listOf(2,4,6).forEach { count -> OutlinedButton({maxPlayers=count},Modifier.weight(1f),colors=ButtonDefaults.outlinedButtonColors(containerColor=if(maxPlayers==count)Gold else Color.Transparent,contentColor=if(maxPlayers==count)Color(0xFF241807) else Color.White)){Text("$count 人")} } }
            Text("积分转为牌桌筹码 · 完整下注轮 · 支持全下边池", color = Color(0xFF9296A3), fontSize = 9.sp)
            Button({actions.createTexas(spaceId,smallBlind,buyIn,maxPlayers)},Modifier.fillMaxWidth().height(50.dp),enabled=!busy&&buyIn>=smallBlind*20,colors=ButtonDefaults.buttonColors(containerColor=Gold,contentColor=Color(0xFF241807))){Icon(Icons.Default.Casino,null);Spacer(Modifier.width(7.dp));Text("带入 ${points(buyIn)} 创建牌桌",fontWeight=FontWeight.Black)}
        }) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color(0xFF151722)).padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically){Text("社区牌桌",Modifier.weight(1f),fontSize=18.sp,fontWeight=FontWeight.Black);Text("${rooms.size} 桌",color=Gold,fontSize=10.sp)}
                if(rooms.isEmpty()) Box(Modifier.fillMaxWidth().height(230.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){Icon(Icons.Default.Casino,null,Modifier.size(40.dp),tint=Color(0xFF6F7280));Text("还没有人开桌",color=Color(0xFF9B9EAA))}}
                rooms.forEach { room -> Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color.White.copy(alpha=.04f)).clickable(enabled=!busy){actions.openTexas(spaceId,room.roomId,room.isMine||room.status!="playing")}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Icon(if(room.status=="playing")Icons.Default.Visibility else Icons.Default.Groups,null,tint=Gold);Column(Modifier.weight(1f).padding(horizontal=10.dp)){Text(room.players.joinToString(" · "){it.username}.ifBlank{"等待玩家"},fontWeight=FontWeight.Bold,maxLines=1);Text("盲注 ${points(room.smallBlind)}/${points(room.bigBlind)} · ${room.players.size}/${room.maxPlayers} 人",color=Color(0xFF7D8190),fontSize=9.sp)};Text(if(room.status=="playing"&&!room.isMine)"观战" else if(room.isMine)"返回" else "加入",color=Gold,fontWeight=FontWeight.Bold,fontSize=10.sp)}
                }
            }
        }; return
    }
    val me=game.meSeat?.let { seat -> game.players.firstOrNull { it.seat==seat } }; val maxRaise=(me?.streetBet?:0)+(me?.stack?:0); var raiseTo by remember(game.roomId,game.handNumber,game.currentBet){mutableLongStateOf(game.minRaiseTo.coerceAtMost(maxRaise.coerceAtLeast(game.minRaiseTo)))}
    GameScaffold("德州扑克 · 第 ${game.handNumber} 手",R.drawable.poio_game_texas,Gold,controls={
        Text(if(game.status=="playing")if(game.canAct)"轮到你操作" else "等待 ${game.players.firstOrNull{it.id==game.currentUserId}?.username?:"玩家"}" else if(game.status=="finished")"本手牌已结束" else "等待房主开局",fontWeight=FontWeight.Black)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color(0xFF10121B)).padding(10.dp),horizontalArrangement=Arrangement.SpaceBetween){Text("筹码 ${me?.stack?.let(::points)?:"观战"}",fontSize=10.sp);Text("底池 ${points(game.pot)}",color=Gold,fontWeight=FontWeight.Bold,fontSize=10.sp)}
        if(game.status=="playing"&&game.canAct&&me!=null){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){OutlinedButton({actions.actTexas(game.roomId,"fold")},Modifier.weight(1f),enabled=!busy){Text("弃牌")};if(game.toCall==0L)Button({actions.actTexas(game.roomId,"check")},Modifier.weight(1f),enabled=!busy){Text("过牌")}else Button({actions.actTexas(game.roomId,"call")},Modifier.weight(1f),enabled=!busy){Text("跟 ${points(game.toCall.coerceAtMost(me.stack))}")};Button({actions.actTexas(game.roomId,"all-in")},Modifier.weight(1f),enabled=!busy,colors=ButtonDefaults.buttonColors(containerColor=Color(0xFFBC4054))){Text("全下")}}
            if(maxRaise>game.currentBet){Text("加注到 ${points(raiseTo)}",color=Gold,fontSize=10.sp);Slider(raiseTo.toFloat(),{raiseTo=it.toLong()},valueRange=game.minRaiseTo.coerceAtMost(maxRaise).toFloat()..maxRaise.toFloat(),steps=0);Button({actions.actTexas(game.roomId,"raise",raiseTo)},Modifier.fillMaxWidth(),enabled=!busy){Text("确认加注")}}
        }
        if(game.status!="playing"&&game.canStart)Button({actions.startTexas(game.roomId)},Modifier.fillMaxWidth(),enabled=!busy,colors=ButtonDefaults.buttonColors(containerColor=Gold,contentColor=Color(0xFF251906))){Icon(Icons.Default.PlayArrow,null);Text("开始第 ${game.handNumber+1} 手")}
        if(game.status!="playing"&&me!=null)OutlinedButton(onInvite,Modifier.fillMaxWidth(),enabled=!busy&&game.players.size<game.maxPlayers){Icon(Icons.Default.PersonAdd,null);Text("邀请在线成员")}
        if(me!=null)OutlinedButton({actions.leaveTexas(game.roomId)},Modifier.fillMaxWidth(),enabled=!busy&&game.status!="playing"){Icon(Icons.Default.Logout,null);Text("离桌并结算")}
        if(me?.id==game.hostUserId)OutlinedButton({actions.closeTexas(game.roomId)},Modifier.fillMaxWidth(),enabled=!busy&&game.status!="playing"){Icon(Icons.Default.Close,null,tint=Color(0xFFFF7187));Text("解散牌桌",color=Color(0xFFFF7187))}
    }) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Felt).border(6.dp,Color(0xFF71491F),RoundedCornerShape(22.dp)).padding(13.dp).verticalScroll(rememberScrollState()),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(game.street.uppercase(),color=Color(0xFFB3D0C7),fontSize=9.sp);Row(horizontalArrangement=Arrangement.spacedBy(4.dp)){repeat(5){index->PokerCard(game.community.getOrNull(index))}};Text("底池 ${points(game.pot)}",color=Gold,fontWeight=FontWeight.Black)
            game.players.forEach { player -> PlayerRow(player,player.id==game.currentUserId,player.id==me?.id) }
            if(game.status=="finished")Text(game.winners.joinToString(" · "){winner->"${game.players.firstOrNull{it.id==winner.userId}?.username} ${winner.handName} +${points(winner.amount)}"},Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xDD0B0E14)).padding(12.dp),color=Gold,textAlign=TextAlign.Center,fontWeight=FontWeight.Bold)
        }
    }
}

@Composable private fun PokerCard(card:GameCard?){Box(Modifier.size(48.dp,68.dp).clip(RoundedCornerShape(6.dp)).background(if(card==null)Color.White.copy(alpha=.08f) else Color(0xFFF7F3E8)).border(1.dp,Color.White.copy(alpha=.15f),RoundedCornerShape(6.dp)),contentAlignment=Alignment.TopStart){if(card!=null){val symbol=when(card.suit){"spades"->"♠";"hearts"->"♥";"diamonds"->"♦";else->"♣"};Text("${card.rank}\n$symbol",Modifier.padding(5.dp),color=if(card.suit=="hearts"||card.suit=="diamonds")Color(0xFFDF4C61)else Color(0xFF171A20),fontWeight=FontWeight.Black,fontSize=12.sp)}}}
@Composable private fun PlayerRow(player:TexasPlayer,active:Boolean,me:Boolean){Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if(active)Gold.copy(alpha=.16f)else Color(0xCC0B1715)).border(1.dp,if(active)Gold else Color.Transparent,RoundedCornerShape(12.dp)).padding(9.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFF755BEE)),contentAlignment=Alignment.Center){Text(player.username.take(1).uppercase(),fontWeight=FontWeight.Black)};Column(Modifier.weight(1f).padding(horizontal=9.dp)){Text(player.username+(if(me)"（你）"else""),fontWeight=FontWeight.Bold,fontSize=11.sp);Text("${points(player.stack)} 筹码${player.blind?.let{" · ${it.uppercase()}"}?:""}",color=Color(0xFF8C918F),fontSize=8.sp)};Row(horizontalArrangement=Arrangement.spacedBy(2.dp)){if(player.hole.isNotEmpty())player.hole.forEach{PokerCard(it)}else repeat(player.cardsHidden){Box(Modifier.size(28.dp,40.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFF684BE0)).border(2.dp,Color(0xFFE9E3FF),RoundedCornerShape(4.dp)))}};if(player.streetBet>0)Text(points(player.streetBet),color=Gold,fontSize=8.sp,modifier=Modifier.padding(start=5.dp))}}
