package cn.poio.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.poio.mobile.markdown.InlineKind
import cn.poio.mobile.markdown.MarkdownBlock
import cn.poio.mobile.markdown.MarkdownParser

@Composable
fun MarkdownMessage(source: String, modifier: Modifier = Modifier) {
    val blocks = remember(source) { MarkdownParser.parse(source) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Paragraph -> InlineMarkdown(block.text)
                is MarkdownBlock.Heading -> InlineMarkdown(
                    source = block.text,
                    baseStyle = SpanStyle(
                        fontSize = when (block.level) {
                            1 -> 22.sp
                            2 -> 20.sp
                            3 -> 18.sp
                            else -> 16.sp
                        },
                        fontWeight = FontWeight.Bold,
                    ),
                )
                is MarkdownBlock.Quote -> Row(
                    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp)),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(3.dp).heightIn(min = 36.dp).background(MaterialTheme.colorScheme.primary))
                    InlineMarkdown(block.text, modifier = Modifier.padding(vertical = 7.dp, horizontal = 4.dp))
                }
                is MarkdownBlock.BulletList -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    block.items.forEach { item ->
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text("•", color = MaterialTheme.colorScheme.secondary)
                            InlineMarkdown(item, modifier = Modifier.weight(1f))
                        }
                    }
                }
                is MarkdownBlock.NumberedList -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    block.items.forEachIndexed { index, item ->
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text("${index + 1}.", color = MaterialTheme.colorScheme.secondary)
                            InlineMarkdown(item, modifier = Modifier.weight(1f))
                        }
                    }
                }
                is MarkdownBlock.Code -> CodeBlock(block)
                MarkdownBlock.Divider -> HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun InlineMarkdown(
    source: String,
    modifier: Modifier = Modifier,
    baseStyle: SpanStyle = SpanStyle(),
) {
    val primary = MaterialTheme.colorScheme.primary
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
    val annotated = remember(source, primary, codeBackground, baseStyle) {
        buildAnnotatedString {
            MarkdownParser.parseInline(source).forEach { run ->
                val start = length
                append(run.text)
                val style = when (run.kind) {
                    InlineKind.PLAIN -> baseStyle
                    InlineKind.BOLD -> baseStyle.merge(SpanStyle(fontWeight = FontWeight.Bold))
                    InlineKind.ITALIC -> baseStyle.merge(SpanStyle(fontStyle = FontStyle.Italic))
                    InlineKind.STRIKE -> baseStyle.merge(SpanStyle(textDecoration = TextDecoration.LineThrough))
                    InlineKind.CODE -> baseStyle.merge(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground))
                    InlineKind.LINK -> baseStyle.merge(SpanStyle(color = primary, textDecoration = TextDecoration.Underline))
                }
                addStyle(style, start, length)
                run.url?.let { addStringAnnotation(URL_TAG, it, start, length) }
            }
        }
    }
    val uriHandler = LocalUriHandler.current
    SelectionContainer {
        @Suppress("DEPRECATION")
        ClickableText(
            text = annotated,
            modifier = modifier,
            style = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
            onClick = { offset ->
                annotated.getStringAnnotations(URL_TAG, offset, offset).firstOrNull()?.item?.let(uriHandler::openUri)
            },
        )
    }
}

@Composable
private fun CodeBlock(block: MarkdownBlock.Code) {
    Column(
        Modifier.fillMaxWidth().background(Color(0xFF101218), RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        block.language?.let {
            Text(it.uppercase(), color = Color(0xFF8E95A8), fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
        SelectionContainer {
            Text(
                text = block.source,
                color = Color(0xFFE6E9F2),
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            )
        }
    }
}

private const val URL_TAG = "poio-url"
