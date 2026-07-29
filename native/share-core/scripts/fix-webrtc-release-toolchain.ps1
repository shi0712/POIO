[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$WebRtcSource,
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'

$toolchainScript = Join-Path $WebRtcSource 'build\vs_toolchain.py'
if (-not (Test-Path -LiteralPath $toolchainScript)) {
    throw "WebRTC Visual Studio toolchain script was not found: $toolchainScript"
}

$content = [IO.File]::ReadAllText($toolchainScript)
$old = @'
  _CopyDebugger(target_dir, target_cpu)
'@
$replacement = @'
  # POIO builds a release static library and does not ship Chromium's symbol
  # tooling. The Debugging Tools SDK component is therefore optional.
  if os.environ.get('POIO_SKIP_DEBUGGER_DLLS') != '1':
    _CopyDebugger(target_dir, target_cpu)
'@

if ($Restore) {
    if ($content.Contains($replacement)) {
        $content = $content.Replace($replacement, $old)
        [IO.File]::WriteAllText(
            $toolchainScript,
            $content,
            [Text.UTF8Encoding]::new($false)
        )
        Write-Host 'Restored the WebRTC release toolchain before dependency sync.'
    } else {
        Write-Host 'WebRTC release toolchain is already in its upstream state.'
    }
    exit 0
}

if ($content.Contains($replacement)) {
    Write-Host 'WebRTC release toolchain patch is already applied.'
    exit 0
}

$occurrences = ([regex]::Matches($content, [regex]::Escape($old))).Count
if ($occurrences -ne 2) {
    throw "Expected two debugger-copy calls, found $occurrences."
}

$content = $content.Replace($old, $replacement)
[IO.File]::WriteAllText(
    $toolchainScript,
    $content,
    [Text.UTF8Encoding]::new($false)
)

Write-Host 'Patched WebRTC release toolchain to make debugger DLLs optional.'
