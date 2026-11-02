@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent_switch.ps1" -Restore
pause
