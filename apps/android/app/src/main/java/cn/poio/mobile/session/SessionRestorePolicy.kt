package cn.poio.mobile.session

import cn.poio.mobile.network.PoioRequestException

/**
 * A stored token is deleted only when the server explicitly rejects it.
 * Timeouts, DNS failures and reconnect races are transient and must never log
 * the user out.
 */
internal fun isExpiredSessionFailure(error: Throwable): Boolean =
    error is PoioRequestException &&
        error.message?.contains("登录已过期") == true
