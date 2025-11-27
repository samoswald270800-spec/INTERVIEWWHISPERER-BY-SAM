@echo off
echo ========================================
echo  Building React App
echo ========================================
echo.
echo Building production-ready React application...
echo.

cd /d "%~dp0\public"
call npm run build

if %errorlevel% neq 0 (
    echo.
    echo Build FAILED! Please check the errors above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Build Successful!
echo ========================================
echo.
echo The React app has been built to: public\build
echo.
echo You can now run the production server with:
echo   start.bat
echo.
echo Or start the development server with:
echo   start-dev.bat
echo.
pause
