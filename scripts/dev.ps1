# Sobe ambiente de desenvolvimento local do roto-master.
# - Garante túnel IAP pro Postgres da VM em 127.0.0.1:5433.
# - Verifica DATABASE_URL no .env.
# - Aplica migrations pendentes (idempotente — usa tabela _migrations).
# - Sobe `node server.js` na primeira porta livre da lista padrão.
#
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev.ps1
# Ou:  scripts\dev.cmd  (wrapper que chama esse script)
#
# Variáveis de ambiente respeitadas:
#   PORT       — força uma porta específica (senão escolhe automaticamente)
#   SKIP_TUNNEL=1 — pula a parte do túnel (útil se ele já estiver de pé em outro contexto)
#   SKIP_MIGRATIONS=1 — pula a aplicação de migrations

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Test-Port($port) {
  try {
    $c = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet
    return [bool]$c
  } catch { return $false }
}

# === 1) Túnel IAP (Postgres da VM) ============================================
if ($env:SKIP_TUNNEL -ne '1') {
  if (Test-Port 5433) {
    Write-Host "[dev] tunel IAP ja de pe em 127.0.0.1:5433" -ForegroundColor DarkGray
  } else {
    Write-Host "[dev] subindo tunel IAP em background (5433 -> adorable-claude:5433)..." -ForegroundColor Cyan
    $gcloud = "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    if (-not (Test-Path $gcloud)) { $gcloud = "gcloud" }
    Start-Process -WindowStyle Minimized -FilePath $gcloud -ArgumentList @(
      'compute','start-iap-tunnel','adorable-claude','5433',
      '--zone=us-central1-a','--local-host-port=localhost:5433'
    )
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      if (Test-Port 5433) { Write-Host "[dev] tunel pronto." -ForegroundColor Green; break }
      Start-Sleep -Milliseconds 800
    }
    if (-not (Test-Port 5433)) {
      Write-Host "[dev] ERRO: tunel nao subiu em 45s. Verifique 'gcloud auth login' e a janela do tunel." -ForegroundColor Red
      exit 1
    }
  }
} else {
  Write-Host "[dev] SKIP_TUNNEL=1 — assumindo tunel ja configurado." -ForegroundColor DarkGray
}

# === 2) Sanity check do .env ==================================================
$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path $envPath)) {
  Write-Host "[dev] ERRO: .env ausente em $envPath" -ForegroundColor Red
  exit 1
}
$envContent = Get-Content $envPath -Raw
foreach ($v in @('DATABASE_URL','DEV_BYPASS','GCS_SERVICE_ACCOUNT','FAL_KEY')) {
  if ($envContent -notmatch "(?m)^$v=") {
    Write-Host "[dev] AVISO: $v faltando no .env — pode causar 500 em runtime." -ForegroundColor Yellow
  }
}

# === 3) Migrations ============================================================
if ($env:SKIP_MIGRATIONS -ne '1') {
  Write-Host "[dev] verificando migrations pendentes..." -ForegroundColor Cyan
  & node scripts\apply-migrations.js
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[dev] ERRO: aplicacao de migrations falhou." -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "[dev] SKIP_MIGRATIONS=1 — pulando." -ForegroundColor DarkGray
}

# === 4) Escolhe porta livre ===================================================
$port = $env:PORT
if (-not $port) {
  foreach ($p in @(5070, 5080, 5090, 5060, 5055, 5056, 5057, 5071, 5072)) {
    if (-not (Test-Port $p)) { $port = "$p"; break }
  }
}
if (-not $port) {
  Write-Host "[dev] ERRO: nenhuma porta livre na lista padrao." -ForegroundColor Red
  exit 1
}
Write-Host "[dev] iniciando server em http://localhost:$port" -ForegroundColor Green
Write-Host "[dev]   Frames Editor: http://localhost:$port/#/fe" -ForegroundColor Green
Write-Host ""

# === 5) Sobe o server =========================================================
$env:PORT = $port
& node server.js
