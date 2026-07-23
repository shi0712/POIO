package cn.poio.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val PoioColors = darkColorScheme(
    primary = Color(0xFF7659FF),
    onPrimary = Color.White,
    secondary = Color(0xFF43DDC4),
    background = Color(0xFF101118),
    surface = Color(0xFF191B24),
    surfaceVariant = Color(0xFF252833),
    onSurface = Color(0xFFECECF3),
    onSurfaceVariant = Color(0xFFA3A6B5),
    error = Color(0xFFFF6577),
)

@Composable
fun PoioTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = PoioColors, content = content)
}
