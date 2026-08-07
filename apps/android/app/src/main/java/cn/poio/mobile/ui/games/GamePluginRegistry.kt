package cn.poio.mobile.ui.games

import androidx.compose.ui.graphics.Color
import cn.poio.mobile.R

enum class MobileGame { LOBBY, BLACKJACK, MINES, CRASH, SLOTS, WHEEL, GOMOKU }
data class MobileGamePlugin(val game: MobileGame, val name: String, val detail: String, val art: Int, val color: Color)

object MobileGameRegistry {
    private val plugins = linkedMapOf<MobileGame, MobileGamePlugin>()
    fun register(plugin: MobileGamePlugin) { check(plugin.game !in plugins) { "重复的 Android 游戏插件: ${plugin.game}" }; plugins[plugin.game] = plugin }
    val games: List<MobileGamePlugin> get() = plugins.values.toList()
    init {
        register(MobileGamePlugin(MobileGame.BLACKJACK, "21 点", "要牌、停牌、加倍", R.drawable.poio_game_blackjack, Color(0xFF9D7CFF)))
        register(MobileGamePlugin(MobileGame.MINES, "Mines", "翻开水晶，随时结算", R.drawable.poio_game_mines, Color(0xFF49DFC7)))
        register(MobileGamePlugin(MobileGame.CRASH, "Crash", "与社区共享同一轮曲线", R.drawable.poio_game_crash, Color(0xFFD6FF5E)))
        register(MobileGamePlugin(MobileGame.SLOTS, "霓虹转轴", "10 条中奖线与免费旋转", R.drawable.poio_game_slots, Color(0xFFFF75BC)))
        register(MobileGamePlugin(MobileGame.WHEEL, "幸运大转盘", "十档倍率与公平种子", R.drawable.poio_game_wheel, Color(0xFFFFD85A)))
        register(MobileGamePlugin(MobileGame.GOMOKU, "联机五子棋", "创建棋桌，实时对弈与观战", R.drawable.poio_game_gomoku, Color(0xFFC9A66B)))
    }
}

