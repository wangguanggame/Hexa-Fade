@echo off
if "%~1"=="" goto doubleclick
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
exit /b %errorlevel%
:doubleclick
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" fbgame -Upload
set "buildResult=%errorlevel%"
pause
exit /b %buildResult%
