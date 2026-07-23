package cn.poio.mobile.session

import cn.poio.mobile.network.PoioRequestException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class SessionRestorePolicyTest {
    @Test
    fun clearsOnlyExplicitlyExpiredServerSession() {
        assertTrue(isExpiredSessionFailure(PoioRequestException("登录已过期，请重新登录")))
    }

    @Test
    fun retainsTokenForTransientFailures() {
        assertFalse(isExpiredSessionFailure(IOException("网络不可用")))
        assertFalse(isExpiredSessionFailure(PoioRequestException("服务器繁忙")))
    }
}
