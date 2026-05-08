# dev.ps1 — orquestrador do ambiente local do roto-master.
#
# Faz tudo sozinho. Não delega problema técnico pro user. Diagnostica e conserta
# (túnel IAP caído, gcloud auth expirado, porta presa, server zumbi, .env podre).
#
# Subcomandos:
#   start    (default) sobe túnel + server. Idempotente — se já está de pé, só reporta.
#   stop     derruba server e túnel desta sessão (não toca em outros processos).
#   restart  stop + start.
#   status   mostra estado de tudo (túnel, server, banco, último deploy em prod).
#   logs     tail -f do server local.
#   doctor   varre o ambiente, conserta o que dá pra consertar, reporta o resto.
#
# Uso (qualquer terminal — cmd, git-bash, pwsh):
#   scripts\dev.cmd                  → start
#   scripts\dev.cmd stop
#   scripts\dev.cmd status
#   scripts\dev.cmd logs
#   scripts\dev.cmd doctor

[CmdletBinding()]
param(
  [Parameter(Position=0)][string]$Command = 'start',
  [int]$Port = 0,
  [switch]$Foreground,
  [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# === Constantes ===============================================================
$TUNNEL_PORT       = 5433
$TUNNEL_VM         = 'adorable-claude'
$TUNNEL_ZONE       = 'us-central1-a'
$TUNNEL_REMOTE     = 5433
$DEFAULT_PORTS     = @(5050, 5070, 5080, 5090, 5060, 5055, 5056)
$STATE_FILE        = Join-Path $projectRoot '.dev-state.json'
$LOG_DIR           = Join-Path $projectRoot 'logs'
$SERVER_LOG        = Join-Path $LOG_DIR 'server.log'
$TUNNEL_LOG        = Join-Path $LOG_DIR 'tunnel.log'
$ENV_FILE          = Join-Path $projectRoot '.env'

if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }

# === Logging ==================================================================
function Say($msg, $color = 'Gray') { Write-Host "[dev] $msg" -ForegroundColor $color }
function Ok($msg)   { Say $msg 'Green' }
function Warn($msg) { Say $msg 'Yellow' }
function Err($msg)  { Say $msg 'Red' }
function Info($msg) { Say $msg 'Cyan' }
function Dim($msg)  { Say $msg 'DarkGray' }

# === Estado persistido ========================================================
function Read-State {
  if (-not (Test-Path $STATE_FILE)) {
    return @{ tunnelPid = $null; serverPid = $null; serverPort = $null }
  }
  try { return Get-Content $STATE_FILE -Raw | ConvertFrom-Json | ConvertTo-Hashtable }
  catch { return @{ tunnelPid = $null; serverPid = $null; serverPort = $null } }
}
function Write-State($state) {
  $state | ConvertTo-Json | Set-Content -Path $STATE_FILE -Encoding UTF8
}
function ConvertTo-Hashtable {
  param([Parameter(ValueFromPipeline)]$obj)
  $h = @{}
  if ($null -eq $obj) { return $h }
  foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = $p.Value }
  return $h
}

# === Process helpers ==========================================================
function Get-ProcessSafe($processId) {
  if (-not $processId) { return $null }
  try { return Get-Process -Id $processId -ErrorAction Stop } catch { return $null }
}

function Get-PidOnPort($port) {
  $match = netstat -ano | Select-String ":$port\s.*LISTENING" | Select-Object -First 1
  if (-not $match) { return $null }
  $parts = $match.ToString() -split '\s+' | Where-Object { $_ }
  if (-not $parts) { return $null }
  try { return [int]$parts[-1] } catch { return $null }
}

function Stop-PidSafe($processId, $label) {
  $proc = Get-ProcessSafe $processId
  if (-not $proc) { return $false }
  try {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    Dim "  $label (PID $processId) derrubado."
    return $true
  } catch {
    Warn "  nao consegui matar $label (PID $processId): $($_.Exception.Message)"
    return $false
  }
}

# === gcloud / túnel IAP =======================================================
function Get-GcloudPath {
  $candidates = @(
    'C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd',
    'C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Test-GcloudAuth {
  $g = Get-GcloudPath
  if (-not $g) { return @{ ok = $false; reason = 'gcloud nao encontrado' } }
  $out = & $g auth list --filter=status:ACTIVE --format="value(account)" 2>&1
  if ($LASTEXITCODE -ne 0 -or -not $out) {
    return @{ ok = $false; reason = 'sem conta gcloud ativa' }
  }
  return @{ ok = $true; account = ($out | Select-Object -First 1) }
}

function Test-TunnelHealth {
  # Healthcheck real: TCP connect + tentar ler 1 byte do banner Postgres.
  # Porta LISTENING isolada nao basta — gcloud pode estar travado sem encaminhar.
  # Postgres responde com mensagem de erro se SSL nao for enviado primeiro;
  # so o fato de haver leitura disponivel em <3s significa que o tunel encaminha.
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', $TUNNEL_PORT, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(3000, $false)) { $client.Close(); return $false }
    $client.EndConnect($iar)
    # Manda startup vazio (8 bytes de length=0 + protocol invalido) pra forcar resposta.
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2000
    $bogus = [byte[]](0,0,0,8,0,0,0,0)
    $stream.Write($bogus, 0, $bogus.Length)
    $buf = New-Object byte[] 1
    $n = $stream.Read($buf, 0, 1)
    $client.Close()
    return ($n -ge 1)
  } catch { return $false }
}

function Start-Tunnel {
  $g = Get-GcloudPath
  if (-not $g) {
    Err 'gcloud nao instalado. Instale o Google Cloud SDK e rode `gcloud auth login`.'
    exit 1
  }

  $auth = Test-GcloudAuth
  if (-not $auth.ok) {
    Warn "auth gcloud invalida ($($auth.reason))."
    Info 'abrindo `gcloud auth login` no browser. Aprove e volte aqui.'
    & $g auth login
    if ($LASTEXITCODE -ne 0) { Err 'login falhou.'; exit 1 }
    Ok 'auth ok.'
  }

  Info "subindo tunel IAP ${TUNNEL_VM}:${TUNNEL_REMOTE} -> 127.0.0.1:${TUNNEL_PORT}"
  # Limpa log anterior pra erro novo aparecer.
  '' | Set-Content -Path $TUNNEL_LOG -Encoding UTF8

  $proc = Start-Process -FilePath $g -ArgumentList @(
    'compute','start-iap-tunnel', $TUNNEL_VM, $TUNNEL_REMOTE,
    "--zone=$TUNNEL_ZONE",
    "--local-host-port=localhost:$TUNNEL_PORT"
  ) -WindowStyle Hidden -PassThru -RedirectStandardOutput $TUNNEL_LOG -RedirectStandardError "$TUNNEL_LOG.err"

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    if (Test-TunnelHealth) {
      $state = Read-State
      $state.tunnelPid = $proc.Id
      Write-State $state
      Ok "tunel pronto (PID $($proc.Id))."
      return
    }
    # Detecta morte precoce do gcloud
    if ($proc.HasExited) {
      Err 'gcloud morreu antes do tunel ficar pronto. Logs:'
      if (Test-Path $TUNNEL_LOG)     { Get-Content $TUNNEL_LOG | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
      if (Test-Path "$TUNNEL_LOG.err") { Get-Content "$TUNNEL_LOG.err" | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
      exit 1
    }
  }
  Err 'tunel nao ficou saudavel em 45s. Matando processo e abortando.'
  Stop-PidSafe $proc.Id 'tunel'
  exit 1
}

function Ensure-Tunnel {
  if ($NoTunnel) { Dim 'NoTunnel — pulando tunel.'; return }
  $state = Read-State
  $existing = Get-ProcessSafe $state.tunnelPid
  if ($existing -and (Test-TunnelHealth)) {
    Dim "tunel ja saudavel (PID $($state.tunnelPid))."
    return
  }
  # Ou porta presa por outro processo (ex: gcloud anterior crasheado),
  # ou nada de pé. Limpa qualquer ocupante da porta antes de subir.
  $occupier = Get-PidOnPort $TUNNEL_PORT
  if ($occupier -and $occupier -ne $state.tunnelPid) {
    $proc = Get-ProcessSafe $occupier
    if ($proc -and $proc.ProcessName -match 'gcloud|python') {
      Warn "porta $TUNNEL_PORT ocupada por gcloud/python orfao (PID $occupier). Derrubando."
      Stop-PidSafe $occupier 'tunel orfao' | Out-Null
      Start-Sleep -Milliseconds 500
    } elseif ($proc) {
      # Se for outro tipo de processo (ex.: Postgres local do user), parar e perguntar
      Err "porta $TUNNEL_PORT ocupada por $($proc.ProcessName) (PID $occupier) — nao e nosso tunel."
      Err '   Libere a porta manualmente ou rode com -Port=<outra> (nao implementado pra tunel ainda).'
      exit 1
    }
  }
  if ($state.tunnelPid -and -not $existing) {
    Dim "tunel anterior (PID $($state.tunnelPid)) nao existe mais. Subindo de novo."
  }
  Start-Tunnel
}

# === .env =====================================================================
function Test-EnvFile {
  if (-not (Test-Path $ENV_FILE)) {
    Err ".env ausente em $ENV_FILE"
    Err 'Recupere de outro projeto ou peca ao user. Sem .env, dev local nao roda.'
    exit 1
  }
  $content = Get-Content $ENV_FILE -Raw
  $required = @('DATABASE_URL','DEV_BYPASS','GCS_SERVICE_ACCOUNT','FAL_KEY')
  $missing = @()
  foreach ($v in $required) {
    if ($content -notmatch "(?m)^$v=.+") { $missing += $v }
  }
  if ($missing.Count -gt 0) {
    Err "vars faltando no .env: $($missing -join ', ')"
    exit 1
  }
}

# === Migrations ===============================================================
function Apply-Migrations {
  Info 'verificando migrations...'
  & node scripts\apply-migrations.js
  if ($LASTEXITCODE -ne 0) {
    Err 'migrations falharam. Banco pode estar fora ou migration ruim.'
    exit 1
  }
}

# === Server ===================================================================
function Pick-Port {
  if ($Port -gt 0) {
    if (Get-PidOnPort $Port) {
      Err "porta $Port ja ocupada."
      exit 1
    }
    return $Port
  }
  foreach ($p in $DEFAULT_PORTS) {
    if (-not (Get-PidOnPort $p)) { return $p }
  }
  Err "nenhuma porta livre nas opcoes padrao: $($DEFAULT_PORTS -join ', ')"
  exit 1
}

function Stop-OldServer {
  $state = Read-State
  if (-not $state.serverPid) { return }
  $proc = Get-ProcessSafe $state.serverPid
  if (-not $proc) {
    Dim "server anterior (PID $($state.serverPid)) ja nao existe."
    $state.serverPid = $null; $state.serverPort = $null; Write-State $state
    return
  }
  # Confirmar que e nosso (node.exe rodando server.js do roto-master)
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($state.serverPid)" -ErrorAction SilentlyContinue).CommandLine
  if ($cmd -and $cmd -match 'roto-master.*server\.js') {
    Warn "matando server anterior (PID $($state.serverPid))."
    Stop-PidSafe $state.serverPid 'server zumbi' | Out-Null
  } else {
    Warn "PID $($state.serverPid) nao e nosso server. Limpando estado."
  }
  $state.serverPid = $null; $state.serverPort = $null; Write-State $state
}

function Start-Server {
  Stop-OldServer
  $port = Pick-Port
  $env:PORT = "$port"

  if ($Foreground) {
    Info "subindo server em foreground em http://localhost:$port"
    Info "  Frames Editor: http://localhost:$port/#/fe"
    & node server.js
    return
  }

  Info "subindo server em background em http://localhost:$port (logs/server.log)"
  '' | Set-Content -Path $SERVER_LOG -Encoding UTF8
  $node = (Get-Command node -ErrorAction Stop).Source
  $proc = Start-Process -FilePath $node -ArgumentList 'server.js' `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $SERVER_LOG -RedirectStandardError "$SERVER_LOG.err" `
    -WorkingDirectory $projectRoot

  # Aguarda o server responder no /api/health
  $deadline = (Get-Date).AddSeconds(15)
  $up = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) {
      Err "server morreu na inicializacao (exit $($proc.ExitCode)). Logs:"
      if (Test-Path $SERVER_LOG)     { Get-Content $SERVER_LOG | Select-Object -Last 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
      if (Test-Path "$SERVER_LOG.err") { Get-Content "$SERVER_LOG.err" | Select-Object -Last 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
      exit 1
    }
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
      if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch {}
  }
  if (-not $up) {
    Err "server nao respondeu /api/health em 15s. Logs:"
    if (Test-Path $SERVER_LOG) { Get-Content $SERVER_LOG | Select-Object -Last 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
    Stop-PidSafe $proc.Id 'server' | Out-Null
    exit 1
  }

  $state = Read-State
  $state.serverPid = $proc.Id
  $state.serverPort = $port
  Write-State $state

  Ok  "tudo pronto."
  Ok  "  app:           http://localhost:$port"
  Ok  "  frames editor: http://localhost:$port/#/fe"
  Dim "  logs:          scripts\dev.cmd logs"
  Dim "  parar:         scripts\dev.cmd stop"
}

# === Subcomandos ==============================================================
function Cmd-Start {
  Test-EnvFile
  Ensure-Tunnel
  Apply-Migrations
  Start-Server
}

function Cmd-Stop {
  $state = Read-State
  if ($state.serverPid) {
    Stop-PidSafe $state.serverPid 'server' | Out-Null
    $state.serverPid = $null; $state.serverPort = $null
  } else { Dim 'sem server registrado.' }
  if ($state.tunnelPid) {
    Stop-PidSafe $state.tunnelPid 'tunel' | Out-Null
    $state.tunnelPid = $null
  } else { Dim 'sem tunel registrado.' }
  Write-State $state
  Ok 'derrubado.'
}

function Cmd-Restart { Cmd-Stop; Start-Sleep -Milliseconds 500; Cmd-Start }

function Cmd-Status {
  $state = Read-State

  Write-Host ''
  Write-Host '  TUNEL IAP' -ForegroundColor Cyan
  $proc = Get-ProcessSafe $state.tunnelPid
  if ($proc -and (Test-TunnelHealth)) {
    Write-Host "    [OK]    PID $($state.tunnelPid)  porta $TUNNEL_PORT  saudavel" -ForegroundColor Green
  } elseif ($proc) {
    Write-Host "    [WARN]  PID $($state.tunnelPid) vivo, mas porta $TUNNEL_PORT nao responde" -ForegroundColor Yellow
  } else {
    Write-Host "    [DOWN]  nao registrado / nao vivo" -ForegroundColor DarkGray
  }

  Write-Host ''
  Write-Host '  SERVER' -ForegroundColor Cyan
  $proc = Get-ProcessSafe $state.serverPid
  if ($proc) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($state.serverPort)/api/health" -TimeoutSec 2 -UseBasicParsing
      Write-Host "    [OK]    PID $($state.serverPid)  porta $($state.serverPort)  $($r.Content)" -ForegroundColor Green
      Write-Host "            http://localhost:$($state.serverPort)" -ForegroundColor DarkGray
    } catch {
      Write-Host "    [WARN]  PID vivo mas /api/health falha: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  } else {
    Write-Host "    [DOWN]  nao registrado / nao vivo" -ForegroundColor DarkGray
  }

  Write-Host ''
  Write-Host '  PROD' -ForegroundColor Cyan
  try {
    $r = Invoke-WebRequest -Uri 'https://roto.did.lu/api/health' -TimeoutSec 5 -UseBasicParsing
    Write-Host "    [OK]    https://roto.did.lu  $($r.Content)" -ForegroundColor Green
  } catch {
    Write-Host "    [DOWN]  https://roto.did.lu nao respondeu: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Write-Host ''
}

function Cmd-Logs {
  if (-not (Test-Path $SERVER_LOG)) {
    Warn "sem $SERVER_LOG ainda. O server foi iniciado nesta sessao?"
    return
  }
  Info "tail -f $SERVER_LOG (Ctrl+C pra sair)"
  Get-Content $SERVER_LOG -Wait -Tail 50
}

function Cmd-Doctor {
  Write-Host ''
  Info 'doctor — varrendo o ambiente.'

  # gcloud
  $auth = Test-GcloudAuth
  if ($auth.ok) { Ok "gcloud auth: $($auth.account)" }
  else { Warn "gcloud auth: $($auth.reason)"; Info '  rodando gcloud auth login...'; & (Get-GcloudPath) auth login }

  # .env
  Test-EnvFile
  Ok '.env: vars obrigatorias presentes.'

  # tunel saudavel?
  if (Test-TunnelHealth) { Ok "tunel: porta $TUNNEL_PORT responde." }
  else { Warn "tunel: porta $TUNNEL_PORT nao responde — vou subir"; Ensure-Tunnel }

  # server zumbi?
  $state = Read-State
  $proc = Get-ProcessSafe $state.serverPid
  if ($proc) { Ok "server: PID $($state.serverPid) na porta $($state.serverPort)." }
  else { Dim 'server: nao esta de pe (use `dev start`).' }

  # banco realmente acessivel via DATABASE_URL?
  Info 'testando query trivial no banco via DATABASE_URL...'
  $node = (Get-Command node -ErrorAction Stop).Source
  $check = & $node -e "require('dotenv').config(); const{Pool}=require('pg'); (async()=>{const p=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000}); try{const r=await p.query('select 1 as ok'); console.log('ok',r.rows[0].ok); process.exit(0);}catch(e){console.error('FAIL',e.message); process.exit(1);}})();"
  if ($LASTEXITCODE -eq 0) { Ok 'banco: SELECT 1 ok.' }
  else { Err "banco: SELECT 1 falhou. Saida: $check" }

  Write-Host ''
  Ok 'doctor terminou.'
}

# === Dispatch =================================================================
switch ($Command.ToLower()) {
  'start'   { Cmd-Start }
  'stop'    { Cmd-Stop }
  'restart' { Cmd-Restart }
  'status'  { Cmd-Status }
  'logs'    { Cmd-Logs }
  'doctor'  { Cmd-Doctor }
  default {
    Err "subcomando desconhecido: $Command"
    Write-Host 'Use: start | stop | restart | status | logs | doctor'
    exit 1
  }
}
