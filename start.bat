@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Infinite Canvas AI Agent - starting...
echo ============================================
echo.

REM Make sure pnpm is available on PATH.
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [error] pnpm was not found on your PATH.
  echo         Install Node.js ^(https://nodejs.org^), then run:
  echo            npm install -g pnpm
  echo.
  pause
  exit /b 1
)

REM Install dependencies on first run.
if not exist "node_modules" (
  echo Installing dependencies ^(first run, this may take a minute^)...
  call pnpm install
  if errorlevel 1 (
    echo.
    echo [error] Dependency install failed.
    pause
    exit /b 1
  )
  echo.
)

REM Start local Docker Postgres when Docker is available.
where docker >nul 2>nul
if errorlevel 1 (
  echo [warn] Docker was not found on your PATH.
  echo        Local Postgres will not start automatically.
  echo        Install Docker Desktop, or run: pnpm db:up
  echo.
) else (
  echo Starting local Postgres ^(Docker^)...
  call pnpm db:up
  if errorlevel 1 (
    echo.
    echo [warn] Could not start Docker Postgres.
    echo        Make sure Docker Desktop is running, then retry:
    echo          pnpm db:up
    echo          pnpm db:migrate
    echo.
  ) else (
    echo Applying local database schema if needed...
    call pnpm db:migrate
    if errorlevel 1 (
      echo.
      echo [warn] Database migrate failed. App may still start, but SQL mode can fail.
      echo        Retry with: pnpm db:migrate
      echo.
    ) else (
      echo Local Postgres is ready on localhost:5432 ^(db: canvas_dev^)
      echo.
    )
  )
)

echo Starting the dev server at http://localhost:3000
echo The browser will open the Supabase login page automatically.
echo ^(Press Ctrl+C in this window to stop.^)
echo.

REM Ensure port 3000 is free: kill active listener or release Windows reservation.
echo Checking port 3000...
set NEED_ELEVATION=0
netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    REM Port is actively used by another process - kill it.
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
        echo Port 3000 is occupied by PID %%a - killing it...
        taskkill /F /PID %%a 2>nul
        timeout /t 2 /nobreak >nul
    )
) else (
    REM No listener. Check if port 3000 is in a Windows excluded range.
    for /f "tokens=1,2" %%a in ('netsh interface ipv4 show excludedportrange protocol^=tcp ^| findstr /r "^[ ]*[0-9]"') do (
        if %%a leq 3000 if %%b geq 3000 set NEED_ELEVATION=1
    )
)

if %NEED_ELEVATION% equ 1 (
    echo Port 3000 is reserved by Windows - requesting admin to release it...
    powershell -Command "Start-Process -FilePath 'net' -ArgumentList 'stop','winnat' -Verb RunAs -Wait -WindowStyle Hidden" 2>nul
    powershell -Command "Start-Process -FilePath 'net' -ArgumentList 'start','winnat' -Verb RunAs -Wait -WindowStyle Hidden" 2>nul
    echo Reservation released. Waiting 3 seconds...
    timeout /t 3 /nobreak >nul
)

REM Open the browser a few seconds after the server starts (runs in parallel).
REM `ping` is used as the delay because it works in any console context (timeout does not).
start "" /min cmd /c "ping -n 5 127.0.0.1 >nul & start "" http://localhost:3000/login"

call pnpm dev

endlocal
