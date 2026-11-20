@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.15 or newer is required. Install it from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)

if not exist "node_modules\bootstrap" (
  echo Installing the app dependencies for the first run...
  call npm.cmd install --omit=dev
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

start "Capitol Stock Management local server" /min cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://127.0.0.1:8766
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=http://127.0.0.1:8766
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=http://127.0.0.1:8766
) else (
  start "" http://127.0.0.1:8766
)
endlocal
