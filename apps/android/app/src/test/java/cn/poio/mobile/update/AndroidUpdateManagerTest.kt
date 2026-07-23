package cn.poio.mobile.update

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream

class AndroidUpdateManagerTest {
    private val hash = "A".repeat(64)

    @Test
    fun parsesTrustedRelativeDownloadUrl() {
        val info = parseAndroidUpdate(
            JSONObject()
                .put("versionCode", 15)
                .put("versionName", "0.1.0-p14")
                .put("url", "/poio/download/POIO-Android-p14.apk")
                .put("sha256", hash.lowercase())
                .put("size", 42_000_000)
                .put("notes", "在线更新"),
            "https://115.159.222.29/poio",
        )

        assertEquals("https://115.159.222.29/poio/download/POIO-Android-p14.apk", info.url)
        assertEquals(hash, info.sha256)
    }

    @Test
    fun rejectsUpdateFromAnotherHost() {
        assertThrows(IllegalArgumentException::class.java) {
            parseAndroidUpdate(
                JSONObject()
                    .put("versionCode", 15)
                    .put("versionName", "0.1.0-p14")
                    .put("url", "https://example.com/fake.apk")
                    .put("sha256", hash)
                    .put("size", 1),
                "https://115.159.222.29/poio",
            )
        }
    }

    @Test
    fun acceptsOfficialModelScopeMirror() {
        val info = parseAndroidUpdate(
            JSONObject()
                .put("versionCode", 15)
                .put("versionName", "0.1.0-p14")
                .put(
                    "url",
                    "https://www.modelscope.cn/models/sjw712/POIO/resolve/master/POIO-Android-0.1.0-p14-arm64-debug.apk",
                )
                .put("sha256", hash)
                .put("size", 42_000_000),
            "https://115.159.222.29/poio",
        )

        assertEquals("www.modelscope.cn", java.net.URI(info.url).host)
    }

    @Test
    fun computesUppercaseSha256WhileStreaming() {
        assertEquals(
            "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
            sha256Hex(ByteArrayInputStream("abc".toByteArray())),
        )
    }

    @Test
    fun acceptsDownloadedApkOnlyWhenEveryManifestFieldMatches() {
        validateDownloadedUpdate(
            expectedSize = 42,
            expectedSha256 = hash,
            expectedPackageName = "cn.poio.mobile",
            expectedVersionCode = 16,
            actualSize = 42,
            actualSha256 = hash.lowercase(),
            actualPackageName = "cn.poio.mobile",
            actualVersionCode = 16,
        )
    }

    @Test
    fun rejectsDownloadedApkWithWrongHash() {
        assertThrows(IllegalArgumentException::class.java) {
            validateDownloadedUpdate(
                expectedSize = 42,
                expectedSha256 = hash,
                expectedPackageName = "cn.poio.mobile",
                expectedVersionCode = 16,
                actualSize = 42,
                actualSha256 = "B".repeat(64),
                actualPackageName = "cn.poio.mobile",
                actualVersionCode = 16,
            )
        }
    }

    @Test
    fun rejectsDownloadedApkWithWrongPackageOrVersion() {
        assertThrows(IllegalArgumentException::class.java) {
            validateDownloadedUpdate(
                expectedSize = 42,
                expectedSha256 = hash,
                expectedPackageName = "cn.poio.mobile",
                expectedVersionCode = 16,
                actualSize = 42,
                actualSha256 = hash,
                actualPackageName = "example.fake",
                actualVersionCode = 999,
            )
        }
    }

    @Test
    fun downloadProgressIsBoundedAndHandlesUnknownTotals() {
        assertEquals(25, updateProgressPercent(25, 100))
        assertEquals(100, updateProgressPercent(120, 100))
        assertEquals(0, updateProgressPercent(-1, 100))
        assertEquals(null, updateProgressPercent(50, -1))
    }
}
