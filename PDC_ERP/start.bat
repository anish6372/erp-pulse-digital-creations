@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo      PDC ERP - Pulse Digital Creation
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 22 LTS or newer, then run this file again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=4" %%A in ('netstat -ano ^| findstr ":3000 .*LISTENING"') do set PID=%%A
if defined PID (
  echo Port 3000 is already in use.
  echo The ERP may already be running.
  echo.
  echo Open this in Chrome/Edge:
  echo    http://localhost:3000
  echo.
  echo If that page does not show PDC ERP, close the program using port 3000
  echo and run this file again.
  echo.
  start "" "http://localhost:3000"
  pause
  exit /b 0
)

set HOST=0.0.0.0
set PORT=3000
echo Starting PDC ERP server...
echo.
node server.js

echo.
echo ========================================
echo The ERP server stopped or returned an error.
echo Keep this window open and read the error above.
echo ========================================
pause
endlocal
