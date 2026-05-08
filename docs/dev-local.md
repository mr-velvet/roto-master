# Dev local + deploy do roto-master

Manual prático. Atualizado 2026-05-08 junto com a reescrita de `scripts/dev.ps1` e `did.ps1`.

---

## TL;DR

```
scripts\dev.cmd                              # sobe túnel + server local
cd ~/ved/devops-workflow-2026                # outra workspace
.\scripts\did.ps1 deploy roto-master         # deploy pra prod
```

Os scripts cuidam de túnel IAP, gcloud auth, porta livre, migrations, server zumbi, healthcheck. Em geral você só roda `dev.cmd` e `did.ps1 deploy` — quando algo não responde, `dev.cmd doctor` ou `did.ps1 doctor` resolvem.

---

## Pré-requisitos da máquina (uma vez)

- `gcloud` CLI instalado e autenticado em `manu@did.lu` no projeto `didlu-main`.
- Acesso IAP-tunnel pro `adorable-claude` (zona `us-central1-a`). Já está provisionado.
- Node 20+.
- `pwsh` (PowerShell 7) recomendado mas opcional — `dev.cmd` cai pra Windows PowerShell 5.1 se não tiver.
- `.env` na raiz do projeto com `DATABASE_URL`, `DEV_BYPASS=1`, `GCS_SERVICE_ACCOUNT`, `FAL_KEY` no mínimo.

Se algum desses estiver faltando, `scripts\dev.cmd doctor` reporta e/ou conserta o que dá.

---

## Dev local — `scripts\dev.cmd`

Funciona em qualquer terminal (cmd.exe, git-bash, pwsh). É o ponto de entrada único.

### Subcomandos

| Comando | O que faz |
|---|---|
| `scripts\dev.cmd` (sem arg) | = `start`. Sobe túnel IAP + migrations + server. Idempotente. |
| `scripts\dev.cmd start` | igual ao acima, explícito. |
| `scripts\dev.cmd stop` | derruba só o que esta sessão subiu (PIDs registrados em `.dev-state.json`). Não toca em outros projetos. |
| `scripts\dev.cmd restart` | stop + start. |
| `scripts\dev.cmd status` | estado de túnel, server local e prod (com cor verde/amarelo/cinza). |
| `scripts\dev.cmd logs` | `tail -f` do `logs/server.log`. Ctrl+C pra sair. |
| `scripts\dev.cmd doctor` | varre o ambiente, conserta o que dá (gcloud auth, túnel, server), reporta o resto. |

### Flags úteis

| Flag | Efeito |
|---|---|
| `-Port 5099` | força uma porta específica em vez da auto-seleção. |
| `-Foreground` | sobe o server em foreground (output direto, Ctrl+C derruba) — útil pra debug. Por padrão sobe em background. |
| `-NoTunnel` | não toca no túnel (assume que outro processo já cuida dele). |

### URLs depois do start

- Galeria/Ateliê: `http://localhost:<porta>/`
- Frames Editor: `http://localhost:<porta>/#/fe`

A porta é a primeira livre dentre `5050, 5070, 5080, 5090, 5060, 5055, 5056` — `status` mostra qual.

### O que `dev.cmd start` faz nos bastidores

1. **Túnel IAP.** Se PID registrado em `.dev-state.json` ainda está vivo e healthcheck passa (round-trip TCP até o Postgres na VM, não só `LISTENING`), pula. Caso contrário, derruba qualquer órfão na 5433 e abre um novo via `gcloud compute start-iap-tunnel adorable-claude 5433 --zone=us-central1-a --local-host-port=localhost:5433`. Se gcloud auth tiver expirado, abre `gcloud auth login` no browser sem perguntar.
2. **Sanity check do `.env`.** Falha cedo se faltar var obrigatória.
3. **Migrations** via `scripts/apply-migrations.js` (idempotente, tabela `_migrations`).
4. **Server.** Mata server zumbi de sessão anterior (validado por `Win32_Process.CommandLine` apontando pro roto-master). Sobe `node server.js` em background com output em `logs/server.log`. Aguarda `/api/health` em `127.0.0.1:<porta>` (não `localhost` — Windows resolve IPv6 e Express está bound em IPv4).

### Estado persistido

- `.dev-state.json` — PIDs do túnel e server (gitignored).
- `logs/server.log` + `logs/server.log.err` — stdout/stderr do server (gitignored).
- `logs/tunnel.log` + `logs/tunnel.log.err` — output do gcloud tunnel (gitignored).

---

## Banco e GCS

- **Postgres é o mesmo de produção.** Não há banco local separado. Mexer em dados localmente afeta prod. Pra isolar destrutivos, nomeie projetos/tirinhas como `[teste]`.
- **GCS também é o mesmo bucket** (`didlu-imagestore` via `https://st.did.lu/...`). Uploads locais sobem pro mesmo lugar de prod.
- **CORS no GCS.** Bucket não responde `Access-Control-Allow-Origin`, então o front não consegue ler bytes via `<img crossOrigin>` ou `fetch()`. Quando precisa dos pixels (gerar `.aseprite`), usa `GET /api/fe/proxy-png?url=<gcs-url>`. Proxy restrito ao prefixo público (anti-SSRF).
- **Auth local.** `DEV_BYPASS=1` no `.env` faz backend e front pularem token. Em produção esse bypass é desligado.

---

## Deploy — `did.ps1 deploy <app>`

Roda de `~/ved/devops-workflow-2026/`. Mesmo comando cobre app novo (faz bootstrap) e update.

```
cd ~/ved/devops-workflow-2026
.\scripts\did.ps1 deploy roto-master
```

### Subcomandos

| Comando | O que faz |
|---|---|
| `did.ps1 deploy <app>` | preflight + deploy. Roda `deploy.sh` na VM, faz health check com retry. |
| `did.ps1 preflight <app>` | só valida (sem deployar). Útil antes de mudar contexto. |
| `did.ps1 logs <app>` | logs do container (default 100 linhas). `-Lines 500` pra mais. |
| `did.ps1 tail <app>` | `docker logs -f` ao vivo. Ctrl+C pra sair. |
| `did.ps1 status` | todos os apps na VM. |
| `did.ps1 status <app>` | só esse, com healthcheck. |
| `did.ps1 secret set/get/list` | gerencia `.env` da plataforma na VM. |
| `did.ps1 ssh "<cmd>"` | escape hatch — comando arbitrário na VM. |
| `did.ps1 doctor` | gcloud auth + ssh + apps rodando. |

### Flags úteis

| Flag | Efeito |
|---|---|
| `-Force` | deploy mesmo com repo local sujo/dessincronizado. **A VM puxa do GitHub, não do seu disco** — use só se sabe que origin já tem o que você quer. |
| `-SkipPreflight` | pula validação. Quase nunca certo, mas existe. |

### O que `did.ps1 deploy` faz nos bastidores

1. **Preflight obrigatório:**
   - gcloud autenticado em `manu@did.lu` no projeto `didlu-main`. Se não, abre login.
   - SSH na VM funciona.
   - Repo local do app (`~/ved/<app>` ou `~/dev/<app>`) limpo: sem mudanças não comitadas, sem commits locais não pushados, não atrás do remote. **Esse era o ponto que mais mordia** — `deploy.sh` na VM faz `git reset --hard origin/<branch>`, então commits locais não chegam. Detecta antes de gastar tempo de deploy.
   - Se encontrar repo sujo, mostra `git status --short` e aborta. `-Force` libera.
2. **Bootstrap se necessário** — se `/home/manu/platform/<app>/` não existe ou não é repo git, clona/inicializa.
3. **`bash /home/manu/platform/scripts/deploy.sh <app>`** na VM. Esse script (parte da plataforma) faz: `git pull`, valida secrets contra `did.json`, sincroniza env vars no compose, aplica migrations, `docker compose build` + `up -d`.
4. **Health check com retry exponencial** (2/3/5/8/13s, ~31s total) em `https://<app>.did.lu/api/health`. Se passar, ok. Se falhar, **automaticamente puxa `docker logs --tail=80`** pra mostrar o erro sem você precisar pedir.

### Quando deploy falha — o que olhar

O wrapper já mostra os logs do container automaticamente quando dá erro. Se isso não basta:

```
.\scripts\did.ps1 logs roto-master -Lines 500
.\scripts\did.ps1 ssh "cd /home/manu/platform && docker compose ps"
.\scripts\did.ps1 ssh "ls -la /home/manu/platform/roto-master"
```

---

## Troubleshooting

| Sintoma | Causa | Fix |
|---|---|---|
| `dev.cmd start` para em "tunel nao ficou saudavel em 45s" | gcloud auth expirou ou IAP firewall removido | `dev.cmd doctor` (vai abrir login) ou `gcloud auth login` direto |
| Server local sobe mas `/api/...` retorna 500 | `DATABASE_URL` errada ou `_migrations` desincronizada | `node scripts/apply-migrations.js` direto pra ver erros |
| Quero saber se túnel/server está de pé | — | `dev.cmd status` |
| Server zumbi consumindo recurso (sumiu da minha sessão mas continua rodando) | sessão anterior não chamou stop | `dev.cmd start` mata zumbi automático; `dev.cmd stop` se só quer derrubar |
| `did.ps1 deploy` para em "working tree sujo" | esqueceu de commitar/pushar | `git status` + commit + push, ou `-Force` se sabe que origin já tem o que quer |
| `did.ps1 deploy` para no health check | container não subiu | logs aparecem automaticamente; geralmente é falta de secret no `.env` da VM (`did.ps1 secret set <KEY> <VALUE>`) |
| `getImageData` falha no console do browser | tentando ler PNG do GCS direto | usar `loadImageForPixels()` no front, que passa por `/api/fe/proxy-png` |
| Caracteres acentuados quebram o script PowerShell | Windows PowerShell 5.1 sem BOM | scripts já têm BOM UTF-8; `dev.cmd` prefere `pwsh` (PS7) quando instalado |

---

## Arquitetura mínima de quem é quem

| Componente | Onde |
|---|---|
| `scripts/dev.ps1` + `dev.cmd` | dentro de `roto-master/` — orquestra dev local |
| `scripts/apply-migrations.js` | dentro de `roto-master/` — migrations idempotentes |
| `scripts/dev-loop.js` | dentro de `roto-master/` — wrapper de auto-restart pro server (uso opcional) |
| `scripts/did.ps1` | em `~/ved/devops-workflow-2026/` — interface única pra plataforma did.lu |
| `/home/manu/platform/scripts/deploy.sh` | na VM — script real de deploy (chamado pelo `did.ps1`) |
| `~/ved/devops-workflow-2026/DEPLOY-GUIDE.md` | manual de toda a plataforma — ler quando quiser entender o resto (Logto, Caddy, novo app, etc.) |
