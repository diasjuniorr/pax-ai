@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-PAX.ps1" -CheckOnly
pause
