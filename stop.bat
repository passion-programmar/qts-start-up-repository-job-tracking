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
echo.
pause
