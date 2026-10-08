@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   QTS_Startup - PUBLIC FRONTEND + LOCAL API
echo ================================================
echo.
echo Starting the local Neon-backed API and Cloudflare
echo tunnel. The public Vercel frontend will open when
echo the tunnel and Vercel API connection are healthy.
echo Leave this window open while using the app.
echo.

call start-server.bat
exit /b %ERRORLEVEL%
