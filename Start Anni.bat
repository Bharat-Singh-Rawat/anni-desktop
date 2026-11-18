@echo off
rem Double-click this file to wake Anni up (Windows).
cd /d "%~dp0"
where node >nul 2>nul || (echo Anni needs Node.js. Install it from https://nodejs.org then double-click this again. & pause & exit /b 1)
if not exist node_modules\electron (
  echo First run: setting Anni up, this takes a minute...
  call npm install --no-audit --no-fund || (echo Setup failed. & pause & exit /b 1)
)
start "" "node_modules\electron\dist\electron.exe" .
