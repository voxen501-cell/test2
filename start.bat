@echo off
title AI Companion Bridge
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo First run, installing the one dependency...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed. Check your internet connection.
    pause
    exit /b 1
  )
)

node src\server.js
echo.
echo Bridge stopped.
pause
