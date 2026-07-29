@echo off
setlocal

call "%~dp0scripts\build-libwebrtc.cmd"
if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -MediaSoup
exit /b %errorlevel%
