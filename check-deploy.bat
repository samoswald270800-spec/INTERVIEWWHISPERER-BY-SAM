@echo off
REM Interview Whisperer - Deployment Health Check (Windows)
REM Run this before deploying to ensure everything is ready

echo.
echo ======================================
echo   Pre-Deployment Health Check
echo ======================================
echo.

set ERRORS=0

REM Check Node version
echo [1/4] Checking Node.js version...
node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not found! Please install Node.js 18+
    set /a ERRORS+=1
) else (
    echo [OK] Node.js installed
)
echo.

REM Check dependencies
echo [2/4] Checking dependencies...
if exist "node_modules\" (
    echo [OK] Root dependencies installed
) else (
    echo [!] Root dependencies missing - run: npm install
    set /a ERRORS+=1
)

if exist "public\node_modules\" (
    echo [OK] React dependencies installed  
) else (
    echo [!] React dependencies missing - run: cd public ^&^& npm install
    set /a ERRORS+=1
)
echo.

REM Check React build
echo [3/4] Checking React build...
if exist "public\build\index.html" (
    echo [OK] React app built
) else (
    echo [!] React build missing - run: cd public ^&^& npm run build
    set /a ERRORS+=1
)
echo.

REM Check .env file
echo [4/4] Checking environment configuration...
if exist ".env" (
    echo [OK] .env file exists
    
    REM Check for required variables
    findstr /C:"OPENAI_API_KEY" .env > nul
    if %errorlevel% neq 0 (
        echo [X] OPENAI_API_KEY not found in .env
        set /a ERRORS+=1
    ) else (
        echo [OK] OPENAI_API_KEY configured
    )
    
    findstr /C:"REDIS_URL" .env > nul
    if %errorlevel% neq 0 (
        echo [X] REDIS_URL not found in .env
        set /a ERRORS+=1
    ) else (
        echo [OK] REDIS_URL configured
    )
    
    findstr /C:"SESSION_SECRET" .env > nul
    if %errorlevel% neq 0 (
        echo [X] SESSION_SECRET not found in .env
        set /a ERRORS+=1
    ) else (
        echo [OK] SESSION_SECRET configured
    )
    
    findstr /C:"ADMIN_USER" .env > nul
    if %errorlevel% neq 0 (
        echo [X] ADMIN_USER not found in .env
        set /a ERRORS+=1
    ) else (
        echo [OK] Admin credentials configured
    )
) else (
    echo [X] .env file missing - copy from .env.example
    set /a ERRORS+=1
)
echo.

REM Summary
echo ======================================
if %ERRORS%==0 (
    echo [SUCCESS] All checks passed!
    echo [READY] You can deploy now!
    echo.
    echo Next steps:
    echo   1. git add .
    echo   2. git commit -m "Ready for deployment"
    echo   3. git push
    echo   4. Deploy on your platform
    echo.
    exit /b 0
) else (
    echo [FAILED] %ERRORS% issue(s) found
    echo Please fix the issues above before deploying
    echo.
    echo See DEPLOYMENT.md for detailed instructions
    echo.
    pause
    exit /b 1
)
