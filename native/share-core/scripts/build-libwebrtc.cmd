@echo off
setlocal

set "REPO_ROOT=%~dp0..\..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "TOOLING_STORAGE=%REPO_ROOT%\.tooling"
set "TOOLING_ROOT=P:"

if not exist "%TOOLING_ROOT%\" (
  subst P: "%TOOLING_STORAGE%"
  if errorlevel 1 exit /b %errorlevel%
)

set "DEPOT_TOOLS=%TOOLING_ROOT%\depot_tools"
set "WEBRTC_SOURCE=%TOOLING_ROOT%\webrtc-checkout\src"
set "WEBRTC_OUTPUT=%WEBRTC_SOURCE%\out\poio-m140"
set "PATH=%DEPOT_TOOLS%;%PATH%"
set "DEPOT_TOOLS_WIN_TOOLCHAIN=0"
set "NINJA_SUMMARIZE_BUILD=1"
set "POIO_SKIP_DEBUGGER_DLLS=1"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"

if not defined vs2022_install (
  if not exist "%VSWHERE%" (
    echo Visual Studio Installer was not found at "%VSWHERE%"
    exit /b 1
  )
  for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "vs2022_install=%%I"
)
if not defined vs2022_install (
  echo Visual Studio 2022 C++ Build Tools were not found.
  exit /b 1
)

call "%~dp0fetch-libwebrtc.cmd"
if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-webrtc-release-toolchain.ps1" -WebRtcSource "%WEBRTC_SOURCE%"
if errorlevel 1 exit /b 1

pushd "%WEBRTC_SOURCE%"
call gn.bat gen out\poio-m140 --args="is_debug=false is_component_build=false target_cpu=\"x64\" is_clang=true rtc_include_tests=false rtc_use_h264=true use_rtti=true use_custom_libcxx=false treat_warnings_as_errors=false symbol_level=0"
if errorlevel 1 (
  popd
  exit /b 1
)

call autoninja.bat -C out\poio-m140 webrtc
if errorlevel 1 (
  popd
  exit /b 1
)
popd

if exist "%WEBRTC_OUTPUT%\obj\webrtc.lib" (
  if not exist "%WEBRTC_OUTPUT%\obj\libwebrtc.lib" (
    mklink /H "%WEBRTC_OUTPUT%\obj\libwebrtc.lib" "%WEBRTC_OUTPUT%\obj\webrtc.lib" >nul
    if errorlevel 1 (
      copy /Y "%WEBRTC_OUTPUT%\obj\webrtc.lib" "%WEBRTC_OUTPUT%\obj\libwebrtc.lib" >nul
      if errorlevel 1 exit /b 1
    )
  )
  echo WebRTC m140 library is ready at "%WEBRTC_OUTPUT%\obj\webrtc.lib"
  exit /b 0
)
if exist "%WEBRTC_OUTPUT%\obj\libwebrtc.lib" (
  echo WebRTC m140 library is ready at "%WEBRTC_OUTPUT%\obj\libwebrtc.lib"
  exit /b 0
)

echo The WebRTC target built, but its static library was not found.
exit /b 1
