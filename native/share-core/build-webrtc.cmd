@echo off
setlocal

call "%~dp0scripts\build-libwebrtc.cmd"
if errorlevel 1 exit /b %errorlevel%

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -WebRtc %*
exit /b %ERRORLEVEL%
