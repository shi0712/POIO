package cn.poio.mobile.markdown

sealed interface MarkdownBlock {
    data class Paragraph(val text: String) : MarkdownBlock
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class BulletList(val items: List<String>) : MarkdownBlock
    data class NumberedList(val items: List<String>) : MarkdownBlock
    data class Code(val language: String?, val source: String) : MarkdownBlock
    data object Divider : MarkdownBlock
}

enum class InlineKind { PLAIN, BOLD, ITALIC, STRIKE, CODE, LINK }

data class InlineRun(
    val text: String,
    val kind: InlineKind = InlineKind.PLAIN,
    val url: String? = null,
)

object MarkdownParser {
    private val heading = Regex("""^(#{1,6})\s+(.+)$""")
    private val bullet = Regex("""^\s*[-+*]\s+(.+)$""")
    private val numbered = Regex("""^\s*\d+[.)]\s+(.+)$""")

    fun parse(source: String): List<MarkdownBlock> {
        val lines = source.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val blocks = mutableListOf<MarkdownBlock>()
        val paragraph = mutableListOf<String>()

        fun flushParagraph() {
            if (paragraph.isNotEmpty()) {
                blocks += MarkdownBlock.Paragraph(paragraph.joinToString("\n"))
                paragraph.clear()
            }
        }

        var index = 0
        while (index < lines.size) {
            val line = lines[index]
            val trimmed = line.trim()
            if (trimmed.isEmpty()) {
                flushParagraph()
                index += 1
                continue
            }

            val fence = fenceMarker(line)
            if (fence != null) {
                flushParagraph()
                val language = line.trimStart().drop(fence.length).trim().takeIf(String::isNotEmpty)
                val code = mutableListOf<String>()
                index += 1
                while (index < lines.size && !lines[index].trimStart().startsWith(fence)) {
                    code += lines[index]
                    index += 1
                }
                if (index < lines.size) index += 1
                blocks += MarkdownBlock.Code(language, code.joinToString("\n"))
                continue
            }

            val headingMatch = heading.matchEntire(line.trimStart())
            if (headingMatch != null) {
                flushParagraph()
                blocks += MarkdownBlock.Heading(
                    level = headingMatch.groupValues[1].length,
                    text = headingMatch.groupValues[2].trim(),
                )
                index += 1
                continue
            }

            if (isDivider(trimmed)) {
                flushParagraph()
                blocks += MarkdownBlock.Divider
                index += 1
                continue
            }

            if (line.trimStart().startsWith(">")) {
                flushParagraph()
                val quote = mutableListOf<String>()
                while (index < lines.size && lines[index].trimStart().startsWith(">")) {
                    quote += lines[index].trimStart().removePrefix(">").removePrefix(" ")
                    index += 1
                }
                blocks += MarkdownBlock.Quote(quote.joinToString("\n"))
                continue
            }

            if (bullet.matches(line)) {
                flushParagraph()
                val items = mutableListOf<String>()
                while (index < lines.size) {
                    val match = bullet.matchEntire(lines[index]) ?: break
                    items += match.groupValues[1]
                    index += 1
                }
                blocks += MarkdownBlock.BulletList(items)
                continue
            }

            if (numbered.matches(line)) {
                flushParagraph()
                val items = mutableListOf<String>()
                while (index < lines.size) {
                    val match = numbered.matchEntire(lines[index]) ?: break
                    items += match.groupValues[1]
                    index += 1
                }
                blocks += MarkdownBlock.NumberedList(items)
                continue
            }

            paragraph += line
            index += 1
        }
        flushParagraph()
        return blocks
    }

    fun parseInline(source: String): List<InlineRun> {
        val result = mutableListOf<InlineRun>()
        val plain = StringBuilder()

        fun flushPlain() {
            if (plain.isNotEmpty()) {
                result += InlineRun(plain.toString())
                plain.clear()
            }
        }

        fun styled(marker: String, kind: InlineKind, index: Int): Int? {
            if (!source.startsWith(marker, index)) return null
            val end = source.indexOf(marker, index + marker.length)
            if (end <= index + marker.length) return null
            flushPlain()
            result += InlineRun(source.substring(index + marker.length, end), kind)
            return end + marker.length
        }

        var index = 0
        while (index < source.length) {
            if (source[index] == '\\' && index + 1 < source.length && source[index + 1] in "\\`*_~[]") {
                plain.append(source[index + 1])
                index += 2
                continue
            }

            if (source[index] == '[') {
                val labelEnd = source.indexOf("](", index + 1)
                val urlEnd = if (labelEnd >= 0) source.indexOf(')', labelEnd + 2) else -1
                if (labelEnd > index + 1 && urlEnd > labelEnd + 2) {
                    val label = source.substring(index + 1, labelEnd)
                    val url = source.substring(labelEnd + 2, urlEnd)
                    if (isSafeWebUrl(url)) {
                        flushPlain()
                        result += InlineRun(label, InlineKind.LINK, url)
                        index = urlEnd + 1
                        continue
                    }
                }
            }

            val next = styled("`", InlineKind.CODE, index)
                ?: styled("**", InlineKind.BOLD, index)
                ?: styled("__", InlineKind.BOLD, index)
                ?: styled("~~", InlineKind.STRIKE, index)
                ?: styled("*", InlineKind.ITALIC, index)
                ?: styled("_", InlineKind.ITALIC, index)
            if (next != null) {
                index = next
                continue
            }
            plain.append(source[index])
            index += 1
        }
        flushPlain()
        return result
    }

    private fun fenceMarker(line: String): String? {
        val trimmed = line.trimStart()
        val marker = when {
            trimmed.startsWith("```") -> trimmed.takeWhile { it == '`' }
            trimmed.startsWith("~~~") -> trimmed.takeWhile { it == '~' }
            else -> return null
        }
        return marker.takeIf { it.length >= 3 }
    }

    private fun isDivider(line: String): Boolean {
        val compact = line.filterNot(Char::isWhitespace)
        return compact.length >= 3 && compact.all { it == '-' }
            || compact.length >= 3 && compact.all { it == '*' }
            || compact.length >= 3 && compact.all { it == '_' }
    }

    private fun isSafeWebUrl(url: String): Boolean {
        if (url.any { it.isWhitespace() || it.code < 32 }) return false
        return url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)
    }
}
