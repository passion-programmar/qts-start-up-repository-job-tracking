@echo off
title QTS Server - Stop
cd /d "%~dp0"
if not "%1"=="quiet" echo.
if not "%1"=="quiet" echo Stopping QTS server...
if "%1"=="quiet" echo  Freeing ports...
call npm run stop >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1
del /F /Q ".cloud-tunnel.lock" >nul 2>&1
if "%1"=="quiet" echo  Waiting for ports to close...
ping 127.0.0.1 -n 3 >nul
if not "%1"=="quiet" (
  echo.
  echo Server stopped.
  pause
)
