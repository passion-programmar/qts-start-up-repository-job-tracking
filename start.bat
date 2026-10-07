@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo          QTS_Startup
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 20 or newer: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting API + UI...
echo   Login: http://localhost:1027/login
echo   API:   http://localhost:1028/api
echo.
echo Press Ctrl+C to stop, or run stop.bat
echo.

call npm start

echo.
echo Server stopped.
pause
