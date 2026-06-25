@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  pause
  exit /b 1
)

echo Stopping QTS_Startup servers...
call npm run stop
taskkill /F /IM cloudflared.exe >nul 2>&1
del /F /Q ".cloud-tunnel.lock" >nul 2>&1
echo.
pause
