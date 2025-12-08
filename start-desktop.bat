@echo off
cd /d "%~dp0"
echo ============================================
echo   Interview Whisperer - Desktop App
echo   (Connecting to Railway)
echo ============================================
echo.

REM Check if .env exists, if not copy from .env.railway
if not exist .env (
    echo Creating .env file...
    copy .env.railway .env
    echo.
    echo IMPORTANT: Edit .env and add your Railway URL!
    echo Example: RAILWAY_URL=https://your-app.up.railway.app
    echo.
    pause
    exit /b 1
)

echo Starting Electron desktop app...
echo Connecting to Railway deployment...
echo.

npx electron .

pause
