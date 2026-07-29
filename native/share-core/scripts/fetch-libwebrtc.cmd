@echo off
setlocal
if defined POIO_TRACE echo on

set "REPO_ROOT=%~dp0..\..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "TOOLING_STORAGE=%REPO_ROOT%\.tooling"
set "TOOLING_ROOT=P:"

if not exist "%TOOLING_ROOT%\" (
  subst P: "%TOOLING_STORAGE%"
  if errorlevel 1 exit /b %errorlevel%
)

set "DEPOT_TOOLS=%TOOLING_ROOT%\depot_tools"
set "WEBRTC_CHECKOUT=%TOOLING_ROOT%\webrtc-checkout"

if not exist "%DEPOT_TOOLS%\fetch.bat" (
  echo depot_tools is missing at "%DEPOT_TOOLS%"
  exit /b 1
)

set "PATH=%DEPOT_TOOLS%;%PATH%"
set "DEPOT_TOOLS_WIN_TOOLCHAIN=0"
set "GIT_CONFIG_COUNT=2"
set "GIT_CONFIG_KEY_0=core.longpaths"
set "GIT_CONFIG_VALUE_0=true"
set "GIT_CONFIG_KEY_1=core.autocrlf"
set "GIT_CONFIG_VALUE_1=false"

if not exist "%WEBRTC_CHECKOUT%" (
  mkdir "%WEBRTC_CHECKOUT%"
  if errorlevel 1 exit /b 1
)

if not exist "%WEBRTC_CHECKOUT%\src\.git" (
  pushd "%WEBRTC_CHECKOUT%"
  call fetch.bat --nohooks --nohistory webrtc
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

pushd "%WEBRTC_CHECKOUT%\src"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-webrtc-release-toolchain.ps1" -WebRtcSource "%WEBRTC_CHECKOUT%\src" -Restore
if errorlevel 1 (
  popd
  exit /b 1
)

call git.bat fetch origin refs/branch-heads/7339:refs/remotes/branch-heads/7339 --depth=1
if errorlevel 1 (
  popd
  exit /b 1
)

call git.bat checkout -B poio-m140 refs/remotes/branch-heads/7339
if errorlevel 1 (
  popd
  exit /b 1
)

call gclient.bat sync --no-history --jobs 1 --nohooks
if errorlevel 1 (
  popd
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-webrtc-gsutil-long-path.ps1" -WebRtcSource "%WEBRTC_CHECKOUT%\src"
if errorlevel 1 (
  popd
  exit /b 1
)

call gclient.bat runhooks
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo WebRTC m140 source is ready at "%WEBRTC_CHECKOUT%\src"
