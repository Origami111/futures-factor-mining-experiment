@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-manual-practice.ps1" %*
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
endlocal
