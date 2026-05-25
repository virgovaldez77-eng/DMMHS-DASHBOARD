@echo off
setlocal EnableDelayedExpansion
title DMMHS Command Center
cd /d "%~dp0"

set "USE_HTTPS=false"
set "NODE_ENV=development"
set "RATE_LIMIT_ENABLED=true"
set "RATE_LIMIT_STRICT=false"

:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--https" (
  set "USE_HTTPS=true"
  set "TRUST_PROXY=true"
  shift
  goto :parse_args
)
if /i "%~1"=="--production" (
  set "NODE_ENV=production"
  shift
  goto :parse_args
)
if /i "%~1"=="--rate-limit-off" (
  set "RATE_LIMIT_ENABLED=false"
  shift
  goto :parse_args
)
if /i "%~1"=="--rate-limit-strict" (
  set "RATE_LIMIT_STRICT=true"
  shift
  goto :parse_args
)
echo %~1| findstr /i /r "^--rate-limit-login=" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  for /f "tokens=2 delims==" %%a in ("%~1") do set "RATE_LIMIT_LOGIN_MAX=%%a"
  shift
  goto :parse_args
)
shift
goto :parse_args

:args_done

echo.
echo  DMMHS Command Center - Starting...
echo  Mode: %NODE_ENV%  HTTPS: %USE_HTTPS%  Rate limit: %RATE_LIMIT_ENABLED%
if /i "%RATE_LIMIT_STRICT%"=="true" echo  Rate limit mode: STRICT ^(3 logins / 30 min^)
echo.

where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  set "NODE_CMD=node"
  goto :runserver
)

if exist "%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe" (
  set "NODE_CMD=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"
  goto :runserver
)

goto :offline

:runserver
echo  Installing dependencies (first run only)...
call npm install --omit=dev 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo  [WARN] npm install had issues - continuing anyway...
)
echo.

if /i "%NODE_ENV%"=="production" (
  if not exist ".env" (
    echo  [!!] PRODUCTION: .env file required with JWT_SECRET and SESSION_SECRET ^(64+ chars^)
    echo       Copy .env.example to .env and run: npm run generate-secrets
    pause
    exit /b 1
  )
  echo  [!!] Production mode - ensure JWT_SECRET, SESSION_SECRET, and TLS certs are configured.
  echo.
)

if /i "%RATE_LIMIT_ENABLED%"=="false" (
  echo  [WARN] Rate limiting DISABLED ^(--rate-limit-off^) — dev only, not for production
) else (
  if defined RATE_LIMIT_LOGIN_MAX (
    echo  Rate limit: login max %RATE_LIMIT_LOGIN_MAX% per window
  ) else (
    echo  Rate limit: login 5 per 15 min ^(default^)
  )
)

set "OPEN_URL=http://localhost:3847"
if /i "%USE_HTTPS%"=="true" (
  set "OPEN_URL=https://localhost:3847"
  echo  Starting HTTPS server at https://localhost:3847
  echo  HTTP redirect: http://localhost:3848 -^> HTTPS
  echo  Dev certs: server\certs\dev-cert.pem ^(self-signed if missing^)
) else (
  echo  Starting server at http://localhost:3847
  echo  Tip: use OPEN-DASHBOARD.bat --https for TLS + security headers
)
echo  Database: server\dmmhs.db
echo  Rate limit log: server\logs\rate-limit.log
echo  Press Ctrl+C to stop.
echo.

start "" "%OPEN_URL%"
set USE_HTTPS=%USE_HTTPS%
set NODE_ENV=%NODE_ENV%
set RATE_LIMIT_ENABLED=%RATE_LIMIT_ENABLED%
set RATE_LIMIT_STRICT=%RATE_LIMIT_STRICT%
"%NODE_CMD%" server\index.js
goto :end

:offline
echo  Node.js not found. Opening OFFLINE dashboard instead...
echo  Install Node.js from https://nodejs.org for full database features.
echo.
start "" "%~dp0public\dashboard.html"
timeout /t 4

:end
endlocal
