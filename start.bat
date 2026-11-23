@echo off
REM Double-click this file on Windows to launch the AgentPulse interactive menu with zero typing!
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   X Could not find Node.js in PATH.
  echo     Please install Node.js 20+ from https://nodejs.org/ and double-click again.
  echo.
  pause
  exit /b 1
)

node scripts\launch.mjs
if errorlevel 1 (
  echo.
  pause
)
endlocal
