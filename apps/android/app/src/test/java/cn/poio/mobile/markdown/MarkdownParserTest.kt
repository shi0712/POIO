package cn.poio.mobile.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownParserTest {
    @Test
    fun parsesBlocksIncludingFencedCode() {
        val blocks = MarkdownParser.parse(
            """
            # 标题

            > 引用
            > 第二行

            - 苹果
            - 香蕉

            ```kotlin
            fun main() = println("POIO")
            ```
            """.trimIndent(),
        )

        assertEquals(MarkdownBlock.Heading(1, "标题"), blocks[0])
        assertEquals(MarkdownBlock.Quote("引用\n第二行"), blocks[1])
        assertEquals(MarkdownBlock.BulletList(listOf("苹果", "香蕉")), blocks[2])
        assertEquals(
            MarkdownBlock.Code("kotlin", "fun main() = println(\"POIO\")"),
            blocks[3],
        )
    }

    @Test
    fun parsesInlineStylesAndSafeLinks() {
        val runs = MarkdownParser.parseInline(
            "**粗体** *斜体* ~~删除~~ `code` [官网](https://115.159.222.29/poio/download/)",
        )

        assertTrue(runs.any { it.kind == InlineKind.BOLD && it.text == "粗体" })
        assertTrue(runs.any { it.kind == InlineKind.ITALIC && it.text == "斜体" })
        assertTrue(runs.any { it.kind == InlineKind.STRIKE && it.text == "删除" })
        assertTrue(runs.any { it.kind == InlineKind.CODE && it.text == "code" })
        assertTrue(runs.any { it.kind == InlineKind.LINK && it.url?.startsWith("https://") == true })
    }

    @Test
    fun doesNotActivateUnsafeLinkSchemes() {
        val runs = MarkdownParser.parseInline("[不要点](javascript:alert(1))")

        assertFalse(runs.any { it.kind == InlineKind.LINK })
        assertEquals("[不要点](javascript:alert(1))", runs.joinToString("") { it.text })
    }

    @Test
    fun keepsUnterminatedFenceAsCode() {
        val blocks = MarkdownParser.parse("```text\nhello")

        assertEquals(listOf(MarkdownBlock.Code("text", "hello")), blocks)
    }
}
