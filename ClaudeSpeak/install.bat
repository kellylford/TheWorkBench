@echo off
REM ClaudeSpeak installer. Double-click this, or run it from a command prompt.
REM It only wraps install.ps1 so you do not have to remember the execution-policy flag.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
