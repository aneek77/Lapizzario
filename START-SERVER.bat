@echo off
title La Pizzario Order Server
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo  ============================================================
  echo   Node.js is not installed on this computer yet.
  echo.
  echo   1. Go to:  https://nodejs.org
  echo   2. Download the LTS version and install it (Next - Next - Finish)
  echo   3. Then double-click this file again.
  echo  ============================================================
  echo.
  start https://nodejs.org
  pause
  exit /b
)

echo.
echo  ============================================================
echo   LA PIZZARIO ORDER SERVER IS STARTING...
echo.
echo   Keep this black window OPEN while taking orders!
echo   (Closing it stops the website and dashboard)
echo.
echo   Website:    http://localhost:3000
echo   Dashboard:  http://localhost:3000/dashboard.html
echo   Password:   pizzario123  (change it in the .env file)
echo  ============================================================
echo.

start "" "http://localhost:3000/dashboard.html"
node server.js
pause
