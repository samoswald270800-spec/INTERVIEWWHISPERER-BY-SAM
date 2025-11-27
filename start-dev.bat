@echo off
echo ========================================
echo  Interview Whisperer - Development Mode
echo ========================================
echo.
echo This will start TWO terminals:
echo   1. Backend Server (port 3000)
echo   2. React Dev Server (port 5174)
echo.
echo Backend will be available at: http://localhost:3000
echo Frontend will be available at: http://localhost:5174
echo.
echo ========================================
echo.

cd /d "%~dp0"

echo Starting Backend Server...
start "Interview Whisperer - Backend" cmd /k "npm start"

timeout /t 3 /nobreak > nul

echo Starting React Dev Server...
cd public
start "Interview Whisperer - Frontend" cmd /k "npm run dev"

echo.
echo Both servers are starting in separate windows.
echo Press any key to exit this window (servers will keep running).
pause > nul
