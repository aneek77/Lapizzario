@echo off
cd /d %~dp0

echo.
echo LA PIZZARIO ORDER SERVER STARTING...
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js is not installed. Download it from https://nodejs.org
    pause
    exit /b
)

echo Website: http://localhost:3000
echo Dashboard: http://localhost:3000/dashboard.html
echo.

start http://localhost:3000/dashboard.html

node server.js

pause