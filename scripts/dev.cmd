@echo off
REM Sobe túnel IAP pro Postgres da VM (se ainda não estiver up) + roda o server local.
REM Pré-req: gcloud SDK + container roto-pgproxy ativo na VM (--restart unless-stopped).

setlocal enabledelayedexpansion

REM ---- 1) testa se 5433 já responde local ----
powershell -NoProfile -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -WarningAction SilentlyContinue; if ($c.TcpTestSucceeded) { exit 0 } else { exit 1 }"
if %ERRORLEVEL% EQU 0 (
  echo [dev] tunel ja esta de pe em 127.0.0.1:5433
  goto :run_server
)

echo [dev] subindo tunel IAP em background ^(127.0.0.1:5433 -^> adorable-claude:5433^)...
start "roto-pgproxy-tunnel" /MIN cmd /c "gcloud compute start-iap-tunnel adorable-claude 5433 --zone=us-central1-a --local-host-port=localhost:5433"

REM espera o tunel
for /L %%i in (1,1,15) do (
  timeout /t 2 /nobreak >nul
  powershell -NoProfile -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -WarningAction SilentlyContinue; exit ([int](!$c.TcpTestSucceeded))"
  if !ERRORLEVEL! EQU 0 (
    echo [dev] tunel pronto.
    goto :run_server
  )
)
echo [dev] ERRO: tunel nao subiu em 30s. Verifique a janela "roto-pgproxy-tunnel".
exit /b 1

:run_server
echo [dev] iniciando server local — porta vem do .env (default 5050)
node server.js

endlocal
