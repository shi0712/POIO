package cn.poio.mobile.ui.games.pool

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.poio.mobile.PoioActions
import cn.poio.mobile.R
import cn.poio.mobile.model.PoolGame
import cn.poio.mobile.model.PoolRoom
import cn.poio.mobile.ui.games.shared.GameScaffold
import cn.poio.mobile.ui.games.shared.WagerControl
import cn.poio.mobile.ui.games.shared.points
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlinx.coroutines.delay

private val PoolMint=Color(0xFF35D6A3)
private val ballColors=listOf(Color(0xFFF5F2E8),Color(0xFFF3C534),Color(0xFF2368C4),Color(0xFFEF414F),Color(0xFF7453BD),Color(0xFFEF7C29),Color(0xFF26975A),Color(0xFF7A251F),Color(0xFF151923),Color(0xFFF3C534),Color(0xFF2368C4),Color(0xFFEF414F),Color(0xFF7453BD),Color(0xFFEF7C29),Color(0xFF26975A),Color(0xFF7A251F))

@Composable
fun PoolView(game:PoolGame?,rooms:List<PoolRoom>,spaceId:String,wager:Long,busy:Boolean,onWager:(Long)->Unit,actions:PoioActions,onInvite:()->Unit){
    if(game==null){
        GameScaffold("8 球台球",R.drawable.poio_game_pool,PoolMint,controls={
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color(0xFF14221F)).padding(13.dp)){
                Text("标准双人 8 球",fontWeight=FontWeight.Black)
                Text("清空自己的分组球，再合法打进 8 号球获胜。",color=Color(0xFF9698A5),fontSize=10.sp)
            }
            WagerControl(wager,!busy,onWager)
            Text("双方奖池 ${points(wager*2)} 积分",color=PoolMint,fontWeight=FontWeight.Black)
            Button({actions.createPool(spaceId,wager)},Modifier.fillMaxWidth().height(50.dp),enabled=!busy,colors=ButtonDefaults.buttonColors(containerColor=PoolMint)){
                Icon(Icons.Default.SportsEsports,null);Spacer(Modifier.width(7.dp));Text("押 ${points(wager)} 积分创建")
            }
        }){
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color(0xFF151722)).padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    Text("社区球桌",fontSize=18.sp,fontWeight=FontWeight.Black)
                    Text("${rooms.count{it.status!="finished"}} 桌可加入",color=PoolMint,fontSize=10.sp)
                }
                if(rooms.isEmpty())Box(Modifier.fillMaxWidth().height(220.dp),contentAlignment=Alignment.Center){Text("还没有人摆下球桌",color=Color(0xFF9698A5))}
                rooms.forEach{room->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color.White.copy(alpha=.04f)).clickable(enabled=!busy){actions.openPool(spaceId,room.roomId,room.isMine||room.status=="waiting")}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){
                        Surface(Modifier.size(38.dp),shape=RoundedCornerShape(50),color=Color(0xFF151923)){Box(contentAlignment=Alignment.Center){Text("8",fontWeight=FontWeight.Black)}}
                        Column(Modifier.weight(1f).padding(horizontal=10.dp)){
                            Text(room.players.joinToString(" vs "){it.username}.ifBlank{"等待玩家"},fontWeight=FontWeight.Bold)
                            Text("每人 ${points(room.wager)} · 第 ${room.roundNumber} 局",color=Color(0xFF777B8B),fontSize=9.sp)
                        }
                        Text(if(room.isMine)"返回" else if(room.status=="waiting")"加入" else "观战",color=PoolMint,fontWeight=FontWeight.Bold)
                    }
                }
            }
        }
        return
    }
    val me=game.players.firstOrNull{it.seat==game.meSeat}
    val turn=game.players.firstOrNull{it.id==game.currentUserId}
    val winner=game.players.firstOrNull{it.id==game.winnerId}
    var aim by remember(game.roomId){mutableFloatStateOf(0f)}
    var power by remember(game.roomId){mutableFloatStateOf(.55f)}
    var displayedBalls by remember(game.roomId){mutableStateOf(game.balls)}
    LaunchedEffect(game.lastShot?.id){
        val frames=game.lastShot?.frames.orEmpty()
        if(frames.isEmpty())displayedBalls=game.balls else{for(frame in frames){displayedBalls=frame;delay(24)};displayedBalls=game.balls}
    }
    val headline=when{
        game.status=="waiting"->"等待另一位玩家加入"
        game.status=="finished"->"${winner?.username?:"玩家"} 获胜"
        game.canPlace->"点击球桌放置母球"
        game.canShoot->"轮到你击球"
        game.meSeat==null->"正在观战"
        else->"等待 ${turn?.username?:"对手"} 击球"
    }
    GameScaffold("8 球台球 · 第 ${game.roundNumber} 局",R.drawable.poio_game_pool,PoolMint,controls={
        Text(headline,fontWeight=FontWeight.Black,color=PoolMint)
        game.players.forEach{player->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(if(player.id==game.currentUserId)Color(0x2235D6A3)else Color.White.copy(alpha=.035f)).padding(10.dp)){
                Column(Modifier.weight(1f)){
                    Text(player.username+(if(player.id==me?.id)"（你）" else ""),fontWeight=FontWeight.Bold)
                    Text(when(player.group){"solids"->"全色球 1–7";"stripes"->"花色球 9–15";else->"尚未分组"},fontSize=9.sp,color=Color(0xFF8C91A0))
                }
            }
        }
        Text("奖池 ${points(game.pot)} · ${game.shotNumber} 杆",color=Color(0xFF9CA2B1))
        game.lastShot?.let{Text(it.message,color=if(it.foul)Color(0xFFFF7187)else PoolMint,fontSize=11.sp)}
        if(game.canShoot){
            Text("力度 ${Math.round(power*100)}%",fontWeight=FontWeight.Bold)
            Slider(power,{power=it},valueRange=.08f..1f,colors=SliderDefaults.colors(thumbColor=PoolMint,activeTrackColor=PoolMint))
            Button({actions.shootPool(game.roomId,aim.toDouble(),power.toDouble())},Modifier.fillMaxWidth(),enabled=!busy,colors=ButtonDefaults.buttonColors(containerColor=PoolMint)){Text("击球")}
        }
        if(game.status=="waiting"&&me!=null)Button(onInvite,Modifier.fillMaxWidth(),colors=ButtonDefaults.buttonColors(containerColor=PoolMint)){Icon(Icons.Default.PersonAdd,null);Spacer(Modifier.width(6.dp));Text("邀请在线成员")}
        if(game.status=="finished"&&me!=null)Button({actions.rematchPool(game.roomId)},Modifier.fillMaxWidth(),enabled=!busy&&me.id !in game.rematchVotes){Text(if(me.id in game.rematchVotes)"等待对手同意" else "再来一局")}
        if(game.status=="playing"&&me!=null)OutlinedButton({actions.resignPool(game.roomId)},Modifier.fillMaxWidth(),enabled=!busy){Text("认输",color=Color(0xFFFF7187))}
        OutlinedButton({actions.leavePool(game.roomId)},Modifier.fillMaxWidth(),enabled=!busy){Text(if(game.status=="waiting"&&me!=null)"解散球桌" else "离开球桌")}
    }){
        PoolTable(game.copy(balls=displayedBalls),aim){x,y->
            if(game.canPlace)actions.placePool(game.roomId,x.toDouble(),y.toDouble())
            else if(game.canShoot){val cue=game.balls.firstOrNull{it.number==0&&!it.pocketed};if(cue!=null)aim=atan2(y-cue.y,x-cue.x)}
        }
    }
}

@Composable
private fun PoolTable(game:PoolGame,aim:Float,onTap:(Float,Float)->Unit){
    Canvas(Modifier.fillMaxWidth().aspectRatio(2f).clip(RoundedCornerShape(18.dp)).pointerInput(game.roomId,game.canPlace,game.canShoot){detectTapGestures{point->onTap(point.x/size.width*1000f,point.y/size.height*500f)}}){
        val sx=size.width/1000f
        val sy=size.height/500f
        drawRoundRect(Color(0xFF684022),cornerRadius=CornerRadius(42f),size=size)
        drawRoundRect(Color(0xFF08745B),topLeft=Offset(38*sx,38*sy),size=Size(924*sx,424*sy),cornerRadius=CornerRadius(30f))
        listOf(54f to 54f,500f to 48f,946f to 54f,54f to 446f,500f to 452f,946f to 446f).forEach{drawCircle(Color(0xFF090D13),25*sx,Offset(it.first*sx,it.second*sy))}
        val cue=game.balls.firstOrNull{it.number==0&&!it.pocketed}
        if(game.canShoot&&cue!=null)drawLine(Color.White.copy(alpha=.6f),Offset(cue.x*sx,cue.y*sy),Offset((cue.x+cos(aim)*150f)*sx,(cue.y+sin(aim)*150f)*sy),2f,pathEffect=PathEffect.dashPathEffect(floatArrayOf(9f,9f)))
        game.balls.filterNot{it.pocketed}.forEach{ball->
            val center=Offset(ball.x*sx,ball.y*sy)
            val radius=13*sx
            drawCircle(if(ball.number>=9)Color(0xFFF7F4EB)else ballColors[ball.number],radius,center)
            drawCircle(Color.Black.copy(alpha=.25f),radius,center,style=Stroke(1.5f))
            if(ball.number>0){
                drawCircle(Color(0xFFF6F4EC),6.2f*sx,center)
                drawContext.canvas.nativeCanvas.drawText(ball.number.toString(),center.x,center.y+3.5f,android.graphics.Paint().apply{color=android.graphics.Color.BLACK;textAlign=android.graphics.Paint.Align.CENTER;textSize=9f*sx;isFakeBoldText=true})
            }
        }
    }
}
