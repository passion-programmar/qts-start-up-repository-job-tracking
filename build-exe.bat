@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Building QTS_Startup Windows .exe
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer first.
  pause
  exit /b 1
)

cd server
if not exist node_modules (
  echo Installing server dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 exit /b 1
)

echo Compiling TypeScript and packaging executable...
call npm run build:exe
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

cd ..
echo.
echo Copying Chrome extension into release folder...
if not exist release mkdir release
xcopy /E /I /Y extension release\extension >nul

if not exist release\.env.example (
  echo Creating release\.env.example...
  (
    echo EMBEDDED_PG=false
    echo DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qts_startup
    echo ADMIN_USERNAME=admin
    echo ADMIN_PASSWORD=change-me
    echo MANAGER_USERNAME=manager
    echo MANAGER_PASSWORD=user
    echo BIDDER_USERNAME=bidder
    echo BIDDER_PASSWORD=user
    echo CALLER_USERNAME=caller
    echo CALLER_PASSWORD=user
    echo JWT_SECRET=replace-with-a-long-random-secret
    echo JWT_EXPIRY=24h
    echo PORT=1028
    echo HOST=127.0.0.1
    echo ADMIN_WEB_URL=http://localhost:1027/login
    echo AUTO_OPEN_BROWSER=true
    echo NODE_ENV=production
  ) > release\.env.example
)

echo.
echo ========================================
echo   Build complete!
echo ========================================
echo.
echo   release\QTS_Startup.exe   - double-click to start API server
echo   release\extension\        - load in Chrome as unpacked extension
echo   release\.env.example      - copy to .env to customize settings
echo.
pause
