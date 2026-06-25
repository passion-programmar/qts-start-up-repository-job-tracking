@echo off
title Sync Vercel (fix login 530)
cd /d "%~dp0"
color 0E
set SYNC_EXIT=0

echo.
echo  ============================================
echo    FIX VERCEL LOGIN (run if login fails)
echo  ============================================
echo.
echo  Keep start-server.bat window OPEN while this runs.
echo  Wait about 2 minutes...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js not found. Install from https://nodejs.org/
  set SYNC_EXIT=1
  goto end
)

if not exist tunnel-url.txt (
  echo  ERROR: tunnel-url.txt not found.
  echo  Run start-server.bat first and keep it open.
  set SYNC_EXIT=1
  goto end
)

if not exist "node_modules\.bin\vercel.cmd" (
  echo  Installing local Vercel CLI - one-time...
  call npm install vercel@54.17.1 --save-dev --no-fund --no-audit
  if errorlevel 1 (
    echo  Vercel CLI install failed.
    set SYNC_EXIT=1
    goto end
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\sync-vercel-api-url.ps1"
set SYNC_EXIT=%ERRORLEVEL%

:end
echo.
if %SYNC_EXIT% neq 0 (
  echo  SYNC FAILED. Check messages above.
) else (
  echo  Done. Test: https://qts-job-tracking.vercel.app/api/health
  echo  Then login: https://qts-job-tracking.vercel.app/login
)
echo.
pause
exit /b %SYNC_EXIT%
