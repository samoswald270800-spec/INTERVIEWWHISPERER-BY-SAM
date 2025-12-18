@echo off
cd /d "%~dp0"
echo =======================================
echo   Interview Whisperer - Desktop Mode
echo   (Connecting to Railway Backend)
echo =======================================
echo.

set NODE_ENV=production
npx electron .

pause
