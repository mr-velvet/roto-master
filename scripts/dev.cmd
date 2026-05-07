@echo off
REM Wrapper magro: delega tudo pro dev.ps1 — funciona igual em cmd.exe e git-bash.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
