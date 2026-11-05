@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "apps\bridge\dist\main.js" (
  echo Compilando el puente...
  call npm run build
  if errorlevel 1 exit /b 1
)

if not exist "%LOCALAPPDATA%\harness-movil\logs" mkdir "%LOCALAPPDATA%\harness-movil\logs"

node "apps\bridge\dist\main.js" >> "%LOCALAPPDATA%\harness-movil\logs\stdout.log" 2>&1
