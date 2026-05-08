@echo off
REM Wrapper magro: delega tudo pro dev.ps1.
REM Prefere pwsh (PS7) por melhor handling de UTF-8/encoding; cai pra Windows PowerShell 5.1.
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
)
