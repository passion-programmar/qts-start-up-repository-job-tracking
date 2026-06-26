@echo off
title QTS Server
cd /d "%~dp0"
color 0A
set EXITCODE=0

echo.
echo  ============================================
echo    QTS JOB TRACKING - START SERVER
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js not found. Install from https://nodejs.org/
  set EXITCODE=1
  goto end
)

REM Only skip start when API + tunnel are both running AND API supports document uploads.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $api = Invoke-RestMethod 'http://127.0.0.1:1028/api/health' -TimeoutSec 3; $tunnel = Get-Process cloudflared -ErrorAction SilentlyContinue; $ok = ($api.success -eq $true) -and ($api.features.documentUploadCategory -eq $true) -and $tunnel; if ($ok) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo  GOOD NEWS: Server is already running on this PC.
  echo.
  echo  You do NOT need to start again. Just use:
  echo    Admin login: https://qts-job-tracking.vercel.app/login
  echo.
  if exist tunnel-url.txt type tunnel-url.txt
  echo.
  echo  Keep this window open OR leave the other server window open.
  echo.
  echo  If login fails with 502 or 530, run:
  echo    1. stop-server.bat
  echo    2. start-server.bat
  echo    3. sync-vercel-api-url.bat
  echo.
  goto end
)

echo  Step 1: Stopping any old server...
call stop-server.bat quiet

echo  Step 2: Starting API + tunnel + Vercel...
echo  Please wait about 2 minutes. Do not press any keys.
echo.

if not exist "node_modules\.bin\vercel.cmd" (
  echo  Installing local Vercel CLI - one-time, may take 1 minute...
  call npm install vercel@54.17.1 --save-dev --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Vercel CLI install failed. Is Node.js installed?
    set EXITCODE=1
    goto failed
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-cloud-tunnel.ps1" -SyncVercel -OpenBrowser
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 goto failed

echo.
echo  Server stopped. You closed it or it crashed.
goto end

:failed
echo.
echo  ============================================
echo    START FAILED - code %EXITCODE%
echo  ============================================
echo.
echo  Check logs\start-server-last.log and logs\api-cloud.err-*.log
echo  If login fails later, run sync-vercel-api-url.bat
echo.

:end
pause
exit /b %EXITCODE%
