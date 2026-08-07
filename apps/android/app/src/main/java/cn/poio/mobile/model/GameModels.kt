package cn.poio.mobile.model

import org.json.JSONObject

data class GameWallet(
    val balance: Long = 0,
    val lastDaily: Long = 0,
    val nextDailyAt: Long = 0,
    val dailyReward: Long = 0,
    val freeSpins: Int = 0,
    val freeWager: Long = 100,
)

data class FairProof(
    val serverSeedHash: String = "",
    val clientSeed: String = "",
    val nonce: Int = 0,
    val serverSeed: String? = null,
    val crashAt: Double? = null,
)

data class GameCard(val rank: String? = null, val suit: String? = null, val hidden: Boolean = false)

data class BlackjackGame(
    val id: String,
    val status: String,
    val outcome: String? = null,
    val wager: Long,
    val payout: Long,
    val player: List<GameCard>,
    val dealer: List<GameCard>,
    val playerScore: Int,
    val dealerScore: Int? = null,
    val canDouble: Boolean,
    val proof: FairProof,
)

data class MinesGame(
    val id: String,
    val status: String,
    val outcome: String? = null,
    val wager: Long,
    val payout: Long,
    val mineCount: Int,
    val revealed: List<Int>,
    val mines: List<Int>,
    val multiplier: Double,
    val nextPayout: Long,
    val proof: FairProof,
)

data class SlotSpin(
    val id: String,
    val wager: Long,
    val freeSpin: Boolean,
    val grid: List<List<String>>,
    val payout: Long,
    val scatterCount: Int,
    val freeSpinsAwarded: Int,
    val proof: FairProof,
)

data class CrashBet(
    val userId: String,
    val username: String,
    val wager: Long,
    val status: String,
    val cashoutMultiplier: Double? = null,
    val payout: Long = 0,
)

data class CrashGame(
    val spaceId: String,
    val roundId: String,
    val phase: String,
    val multiplier: Double,
    val bettingEndsAt: Long,
    val bets: List<CrashBet>,
    val myBet: CrashBet? = null,
    val proof: FairProof,
)

data class GameCenterState(
    val loading: Boolean = false,
    val open: Boolean = false,
    val wallet: GameWallet? = null,
    val blackjack: BlackjackGame? = null,
    val mines: MinesGame? = null,
    val slots: SlotSpin? = null,
    val crash: CrashGame? = null,
)

object GameJson {
    fun wallet(value: JSONObject) = GameWallet(
        balance = value.optLong("balance"),
        lastDaily = value.optLong("lastDaily"),
        nextDailyAt = value.optLong("nextDailyAt"),
        dailyReward = value.optLong("dailyReward"),
        freeSpins = value.optInt("freeSpins"),
        freeWager = value.optLong("freeWager", 100),
    )

    fun proof(value: JSONObject?) = FairProof(
        serverSeedHash = value?.optString("serverSeedHash").orEmpty(),
        clientSeed = value?.optString("clientSeed").orEmpty(),
        nonce = value?.optInt("nonce") ?: 0,
        serverSeed = value?.optString("serverSeed")?.takeIf(String::isNotBlank),
        crashAt = value?.takeIf { it.has("crashAt") }?.optDouble("crashAt"),
    )

    private fun card(value: JSONObject) = GameCard(
        rank = value.optString("rank").takeIf(String::isNotBlank),
        suit = value.optString("suit").takeIf(String::isNotBlank),
        hidden = value.optBoolean("hidden"),
    )

    fun blackjack(value: JSONObject?) = value?.let {
        BlackjackGame(
            id = it.getString("id"), status = it.getString("status"),
            outcome = it.optString("outcome").takeIf(String::isNotBlank),
            wager = it.optLong("wager"), payout = it.optLong("payout"),
            player = it.optJSONArray("player").objects().map(::card),
            dealer = it.optJSONArray("dealer").objects().map(::card),
            playerScore = it.optInt("playerScore"),
            dealerScore = it.takeIf { value -> value.has("dealerScore") }?.optInt("dealerScore"),
            canDouble = it.optBoolean("canDouble"), proof = proof(it.optJSONObject("proof")),
        )
    }

    private fun ints(value: org.json.JSONArray?) = buildList {
        if (value != null) for (index in 0 until value.length()) add(value.optInt(index))
    }

    fun mines(value: JSONObject?) = value?.let {
        MinesGame(
            id = it.getString("id"), status = it.getString("status"),
            outcome = it.optString("outcome").takeIf(String::isNotBlank),
            wager = it.optLong("wager"), payout = it.optLong("payout"), mineCount = it.optInt("mineCount"),
            revealed = ints(it.optJSONArray("revealed")), mines = ints(it.optJSONArray("mines")),
            multiplier = it.optDouble("multiplier", 1.0), nextPayout = it.optLong("nextPayout"),
            proof = proof(it.optJSONObject("proof")),
        )
    }

    fun slot(value: JSONObject?) = value?.let {
        SlotSpin(
            id = it.getString("id"), wager = it.optLong("wager"), freeSpin = it.optBoolean("freeSpin"),
            grid = buildList {
                val reels = it.optJSONArray("grid")
                if (reels != null) for (reel in 0 until reels.length()) {
                    val symbols = reels.optJSONArray(reel)
                    add(buildList { if (symbols != null) for (row in 0 until symbols.length()) add(symbols.optString(row)) })
                }
            },
            payout = it.optLong("payout"), scatterCount = it.optInt("scatterCount"),
            freeSpinsAwarded = it.optInt("freeSpinsAwarded"), proof = proof(it.optJSONObject("proof")),
        )
    }

    private fun crashBet(value: JSONObject) = CrashBet(
        userId = value.optString("userId"), username = value.optString("username"), wager = value.optLong("wager"),
        status = value.optString("status"),
        cashoutMultiplier = value.takeIf { it.has("cashoutMultiplier") && !it.isNull("cashoutMultiplier") }?.optDouble("cashoutMultiplier"),
        payout = value.optLong("payout"),
    )

    fun crash(value: JSONObject?) = value?.let {
        CrashGame(
            spaceId = it.optString("spaceId"), roundId = it.optString("roundId"), phase = it.optString("phase"),
            multiplier = it.optDouble("multiplier", 1.0), bettingEndsAt = it.optLong("bettingEndsAt"),
            bets = it.optJSONArray("bets").objects().map(::crashBet),
            myBet = it.optJSONObject("myBet")?.let(::crashBet), proof = proof(it.optJSONObject("proof")),
        )
    }
}
