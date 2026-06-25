@echo off
title QTS API + Cloudflare Tunnel
cd /d "%~dp0"
set EXITCODE=0

echo.
echo  Tunnel only (no Vercel sync). For normal use, run start-server.bat instead.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js not found. Install from https://nodejs.org/
  set EXITCODE=1
  goto end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-cloud-tunnel.ps1"
set EXITCODE=%ERRORLEVEL%

:end
if %EXITCODE% neq 0 echo  START FAILED - code %EXITCODE%. Check logs\start-server-last.log
echo.
pause
exit /b %EXITCODE%
