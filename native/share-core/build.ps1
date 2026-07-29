[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo')]
    [string]$Configuration = 'RelWithDebInfo',
    [switch]$Clean,
    [switch]$WebRtc,
    [switch]$MediaSoup
)

$ErrorActionPreference = 'Stop'

$sourceDirectory = $PSScriptRoot
$buildDirectory = Join-Path $sourceDirectory $(if ($MediaSoup) { 'build-mediasoup' } elseif ($WebRtc) { 'build-webrtc' } else { 'build' })
$vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath $vsWhere)) {
    throw 'Visual Studio Installer (vswhere.exe) was not found.'
}

$visualStudio = & $vsWhere -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
if (-not $visualStudio) {
    throw 'Visual Studio 2022 C++ Build Tools were not found.'
}

$developerEnvironment = Join-Path $visualStudio 'VC\Auxiliary\Build\vcvars64.bat'
$cmake = Join-Path $visualStudio 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ctest = Join-Path $visualStudio 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe'
$ninja = Join-Path $visualStudio 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'

foreach ($requiredFile in @($developerEnvironment, $cmake, $ctest, $ninja)) {
    if (-not (Test-Path -LiteralPath $requiredFile)) {
        throw "Required build tool was not found: $requiredFile"
    }
}

if ($Clean -and (Test-Path -LiteralPath $buildDirectory)) {
    $resolvedSource = (Resolve-Path -LiteralPath $sourceDirectory).Path
    $resolvedBuild = (Resolve-Path -LiteralPath $buildDirectory).Path
    if (-not $resolvedBuild.StartsWith("$resolvedSource\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean build directory outside source tree: $resolvedBuild"
    }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}

$configureArgumentItems = @(
    '-S', "`"$sourceDirectory`"",
    '-B', "`"$buildDirectory`"",
    '-G', 'Ninja',
    "-DCMAKE_MAKE_PROGRAM=`"$ninja`"",
    "-DCMAKE_BUILD_TYPE=$Configuration",
    '-DBUILD_TESTING=ON'
)

if ($MediaSoup) {
    $WebRtc = $true
}

if ($WebRtc) {
    $repoRoot = (Resolve-Path -LiteralPath (Join-Path $sourceDirectory '..\..')).Path
    $toolingStorage = Join-Path $repoRoot '.tooling'
    $webRtcSource = Join-Path $toolingStorage 'webrtc-checkout\src'
    $webRtcLibrary = Join-Path $webRtcSource 'out\poio-m140\obj\webrtc.lib'
    if (-not (Test-Path -LiteralPath $webRtcLibrary)) {
        throw "The optimized WebRTC library was not found: $webRtcLibrary"
    }
    $configureArgumentItems += @(
        '-DPOIO_SHARE_ENABLE_WEBRTC=ON',
        "-DPOIO_LIBWEBRTC_SOURCE=`"$webRtcSource`"",
        "-DPOIO_LIBWEBRTC_LIBRARY=`"$webRtcLibrary`""
    )
}

if ($MediaSoup) {
    $libMediaSoupClientSource = Join-Path $toolingStorage 'libmediasoupclient'
    if (-not (Test-Path -LiteralPath (Join-Path $libMediaSoupClientSource 'CMakeLists.txt'))) {
        throw "The official libmediasoupclient checkout was not found: $libMediaSoupClientSource"
    }
    $configureArgumentItems += @(
        '-DPOIO_SHARE_ENABLE_MEDIASOUP=ON',
        "-DPOIO_LIBMEDIASOUPCLIENT_SOURCE=`"$libMediaSoupClientSource`""
    )
}

$configureArguments = $configureArgumentItems -join ' '

$buildArguments = "--build `"$buildDirectory`" --parallel"
$testArguments = "--test-dir `"$buildDirectory`" --output-on-failure"
$command = "`"$developerEnvironment`" >nul && " +
    "`"$cmake`" $configureArguments && " +
    "`"$cmake`" $buildArguments && " +
    "`"$ctest`" $testArguments"

& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) {
    throw "POIO share core build failed with exit code $LASTEXITCODE."
}

Write-Host "POIO share core is ready: $(Join-Path $buildDirectory 'poio-share-lab.exe')"
