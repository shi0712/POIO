[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$shareCore = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $shareCore '..\..')).Path
$sidecar = Join-Path $shareCore 'build-mediasoup\poio-share-sidecar.exe'
$destination = Join-Path $repoRoot 'apps\desktop\resources\share'

if (-not $SkipBuild) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $shareCore 'build.ps1') -MediaSoup
    if ($LASTEXITCODE -ne 0) {
        throw "The native screen-sharing build failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path -LiteralPath $sidecar)) {
    throw "The native screen-sharing sidecar was not found: $sidecar"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $sidecar `
    -Destination (Join-Path $destination 'poio-share-sidecar.exe') -Force

$licenseFiles = @(
    @{
        Source = Join-Path $repoRoot '.tooling\webrtc-checkout\src\LICENSE'
        Name = 'LICENSE-libwebrtc.txt'
    },
    @{
        Source = Join-Path $repoRoot '.tooling\libmediasoupclient\LICENSE'
        Name = 'LICENSE-libmediasoupclient.txt'
    },
    @{
        Source = Join-Path $shareCore 'build-mediasoup\_deps\libsdptransform-src\LICENSE'
        Name = 'LICENSE-libsdptransform.txt'
    }
)

foreach ($license in $licenseFiles) {
    if (-not (Test-Path -LiteralPath $license.Source)) {
        throw "A required third-party license was not found: $($license.Source)"
    }
    Copy-Item -LiteralPath $license.Source `
        -Destination (Join-Path $destination $license.Name) -Force
}

$staged = Get-Item -LiteralPath (Join-Path $destination 'poio-share-sidecar.exe')
Write-Host "Staged native screen-sharing sidecar ($($staged.Length) bytes): $($staged.FullName)"
