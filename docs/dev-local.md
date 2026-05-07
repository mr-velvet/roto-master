# Subir o roto-master localmente

Atalho rápido (resolve tudo num comando):

```
scripts\dev.cmd
```

Ou direto em PowerShell:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev.ps1
```

O script:

1. Abre túnel IAP `127.0.0.1:5433 → adorable-claude:5433` (Postgres da VM em produção). Se já está de pé, pula.
2. Confere `.env` (avisa se faltar `DATABASE_URL`/`DEV_BYPASS`/`GCS_SERVICE_ACCOUNT`/`FAL_KEY`).
3. Aplica migrations pendentes via `scripts/apply-migrations.js` (idempotente — usa `_migrations`).
4. Escolhe primeira porta livre da lista `5070, 5080, 5090, 5060, 5055, 5056, 5057` (evita conflitar com outros servidores que rodam na mesma máquina).
5. Sobe `node server.js` na porta escolhida e imprime as URLs.

URLs principais:

- Galeria/Ateliê: `http://localhost:<porta>/`
- Frames Editor: `http://localhost:<porta>/#/fe`

## Variáveis úteis

| Variável | Efeito |
|---|---|
| `PORT=5099` | força uma porta específica em vez de escolher automaticamente |
| `SKIP_TUNNEL=1` | assume que o túnel já está de pé (útil se outro projeto já abriu o 5433) |
| `SKIP_MIGRATIONS=1` | não roda o `apply-migrations.js` (mais rápido, use só se já aplicou nesta sessão) |

## Banco e dados

- Mesmo Postgres de produção. Não há banco "local" separado. Mexer em dados localmente afeta produção.
- Para isolar trabalho destrutivo, criar `tirinhas`/`projects` nomeados explicitamente como teste.
- Bucket GCS é o mesmo (`didlu-imagestore` via `https://st.did.lu/...`). Uploads locais sobem pro mesmo bucket.

## CORS no GCS

O bucket não responde `Access-Control-Allow-Origin`, então `<img crossOrigin="anonymous">` e `fetch()` direto do front não dão acesso aos bytes (canvas tainted, `getImageData` falha). Quando o front precisa dos pixels (gerar `.aseprite` no download), usa `GET /api/fe/proxy-png?url=<gcs-url>`. O proxy é restrito ao prefixo público do bucket (anti-SSRF).

## Auth local

`DEV_BYPASS=1` no `.env` faz o backend pular validação de `APP_TOKEN` e o frontend manda string fake. Roda sem fricção. Em produção, esse bypass é desligado.

## Pré-requisitos da máquina

- `gcloud` CLI autenticado (`gcloud auth login`).
- Permissão IAP-tunnel pro projeto da VM (`adorable-claude`, zona `us-central1-a`).
- Node 20+ (qualquer versão recente serve).
- O container `roto-pgproxy` na VM está com `--restart unless-stopped`, ou seja, sobrevive a reboot — em geral o túnel sobe direto.

## Quando algo não funciona

| Sintoma | Causa provável | Fix |
|---|---|---|
| `[dev] ERRO: tunel nao subiu em 45s` | gcloud não autenticado, ou IAP firewall removido | `gcloud auth login` + checar `firewall-rules list \| grep iap-pgproxy` na VM |
| Server sobe, mas API retorna 500 | `DATABASE_URL` errada ou `_migrations` desincronizada | rodar `node scripts/apply-migrations.js` manual e ver erros |
| Porta diferente toda vez | comportamento normal — script pega primeira livre | use `PORT=5099` se quiser fixa |
| `getImageData` falha no console do browser | tentando ler PNG do GCS direto sem proxy | usar `loadImageForPixels()` (front), que passa por `/api/fe/proxy-png` |

## Deploy pra produção

Não cobre dev local. Ver `PROGRESS.md` (seção "Deploy") e `~/dev/claude-preferences/DEPLOY-GUIDE.md`. Resumo: `cd ~/ved/devops-workflow-2026 && .\scripts\did.ps1 deploy roto-master`.
