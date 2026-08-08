package cn.poio.mobile.ui.games

import androidx.compose.ui.graphics.Color
import cn.poio.mobile.ui.games.blackjack.BlackjackPlugin
import cn.poio.mobile.ui.games.crash.CrashPlugin
import cn.poio.mobile.ui.games.gomoku.GomokuPlugin
import cn.poio.mobile.ui.games.mines.MinesPlugin
import cn.poio.mobile.ui.games.slots.SlotsPlugin
import cn.poio.mobile.ui.games.wheel.WheelPlugin
import cn.poio.mobile.ui.games.texasholdem.TexasHoldemPlugin

enum class MobileGame { LOBBY, BLACKJACK, MINES, CRASH, SLOTS, WHEEL, GOMOKU, TEXAS_HOLDEM }
data class MobileGamePlugin(val game: MobileGame, val name: String, val detail: String, val art: Int, val color: Color)

object MobileGameRegistry {
    private val plugins = linkedMapOf<MobileGame, MobileGamePlugin>()
    fun register(plugin: MobileGamePlugin) { check(plugin.game !in plugins) { "重复的 Android 游戏插件: ${plugin.game}" }; plugins[plugin.game] = plugin }
    val games: List<MobileGamePlugin> get() = plugins.values.toList()
    init {
        register(BlackjackPlugin)
        register(MinesPlugin)
        register(CrashPlugin)
        register(SlotsPlugin)
        register(WheelPlugin)
        register(GomokuPlugin)
        register(TexasHoldemPlugin)
    }
}
