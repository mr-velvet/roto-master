# Arquitetura Técnica — roto-master

Última atualização: 2026-05-04. **Status: arquitetura inicial. Espelho técnico da visão fechada em `visao-da-ferramenta.md`.**

> **Pré-requisito de leitura.** Este documento existe pra dar suporte técnico à visão. Em qualquer conflito entre arquitetura e visão, **a visão vence**. A visão (`docs/visao-da-ferramenta.md`) e o protótipo aprovado (`prototype/`) são as fontes de verdade do produto.

> **Régua deste projeto.** Time interno pequeno e fechado de artistas. Não é SaaS público. Não há ameaça externa modelada. Decisões técnicas favorecem **simplicidade e legibilidade** sobre robustez genérica de produto público. Quando em dúvida entre uma solução cerimoniosa e uma direta, escolher a direta.

---

## 1. Stack atual (não revisitar sem motivo)

- **Backend:** Express 4 + node-postgres. Postgres compartilhado da plataforma `did.lu`.
- **Auth:** Logto (`auth.did.lu`) via Google OAuth. Token opaco validado em `/oidc/me` por request. `req.user.sub` é a chave de escopo de tudo.
- **Frontend:** vanilla ES modules + CDN. Sem build step. Servido via `express.static('public')`.
- **Storage de arquivos:** GCS bucket `didlu-imagestore`, URL pública via `https://st.did.lu/<path>`.
- **Roteamento:** hash routing (`#/list`, `#/v/:id`). Sem history API.
- **Migrations:** arquivos `.sql` em `migrations/` rodam em ordem alfabética no deploy via plataforma did.lu.
- **Container:** node:20-alpine, porta 5031 declarada em `did.json`. Caddy serve `roto.did.lu` com HTTPS automático.

## 2. Modelo de dados

Mapeamento direto das entidades da seção 4 da visão pra tabelas Postgres. Toda tabela tem `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`, `updated_at`. Convenção de coluna de escopo: `owner_sub TEXT NOT NULL`.

### 2.1 Diagrama lógico

```
USERS (implícito — owner_sub do Logto, sem tabela)
  │
  ├── projects (owner_sub = quem criou)
  │     └── project_members (project_id, member_sub, role)
  │           projects são compartilhados; ver permissão na seção 2.5
  │
  ├── workbench do usuário (tudo escopado por owner_sub direto):
  │     ├── videos
  │     ├── personagens
  │     │     ├── personagem_aparencias  (parent: personagem)
  │     │     ├── personagem_enquadramentos  (parent: aparencia)
  │     │     └── personagem_movimentos  (parent: enquadramento)
  │     ├── enquadramentos_avulsos       (sem personagem dono — reusáveis)
  │     ├── cameras_salvas
  │     └── jobs (geração assíncrona)
  │
  └── projects.id ←── assets (entregáveis publicados; FK pra video da workbench)
```

### 2.2 Tabelas de domínio (workbench do usuário)

**`videos`** — recurso da workbench. Já existe (migration 001), expandir.

| coluna | tipo | nota |
|---|---|---|
| `id` | UUID PK | já existe |
| `owner_sub` | TEXT | dono do vídeo (workbench é do usuário) |
| `owner_email` | TEXT | denormalizado pra exibição |
| `name` | TEXT | renomeável |
| `origin` | TEXT | `'uploaded'` \| `'url'` \| `'generated-generic'` \| `'generated-from-character'`. Default `'uploaded'`. |
| `gcs_path`, `gcs_url` | TEXT | path no bucket + URL pública via `st.did.lu` |
| `size_bytes`, `duration_s`, `width`, `height` | numérico | metadata do arquivo |
| `edit_state` | JSONB | PARAMS, in/out, fps, scale, preset selecionado |
| `published_asset_id` | UUID FK assets(id) NULL | NULL = ainda não publicado. Quando republica, mantém o mesmo asset. |
| `source_aparencia_id` | UUID FK personagem_aparencias(id) NULL | snapshot da aparência se origin = `generated-from-character` |
| `source_enquadramento_id` | UUID NULL | idem; pode apontar pra `personagem_enquadramentos` ou `enquadramentos_avulsos` (resolução por convenção, ver 2.6) |
| `source_motion_prompt` | TEXT NULL | prompt de movimento usado na etapa 3 |
| `source_model_key` | TEXT NULL | key do modelo i2v usado |
| `share_id` | UUID UNIQUE | já existe; pra share link público (futuro) |

**Snapshot imutável (decisão da visão item 8):** os campos `source_*_id` são FKs `ON DELETE SET NULL`. Se o personagem/enquadramento for descartado, o vídeo continua existindo — perde só a rastreabilidade da origem. Os campos `source_motion_prompt` e `source_model_key` são denormalizados de propósito (ficam mesmo se a árvore sumir).

**`personagens`** — recurso da workbench, agrupa variações.

| coluna | tipo | nota |
|---|---|---|
| `owner_sub` | TEXT | dono |
| `name` | TEXT | renomeável; default `'sem nome'` (artista nomeia depois) |
| `cover_aparencia_id` | UUID FK personagem_aparencias(id) NULL | qual aparência aparece como capa do card. Ver "favorita" em 2.4. |

**`personagem_aparencias`** — etapa 1 do Fluxo D.

| coluna | tipo | nota |
|---|---|---|
| `personagem_id` | UUID FK personagens(id) ON DELETE CASCADE | |
| `prompt` | TEXT | descrição livre do artista |
| `style` | TEXT | `'realismo'` \| `'semi-realista'` \| `'cartoon'` |
| `model_key` | TEXT | qual modelo gerou |
| `gcs_url` | TEXT | imagem gerada |
| `state` | TEXT | `'favorita'` \| `'neutra'` \| `'descartada'`. Default `'neutra'`. |
| `cost_actual` | NUMERIC(10,4) NULL | custo real cobrado |

**`personagem_enquadramentos`** — etapa 2 do Fluxo D, vinculado a uma aparência específica.

| coluna | tipo | nota |
|---|---|---|
| `parent_aparencia_id` | UUID FK personagem_aparencias(id) ON DELETE CASCADE | |
| `camera_state` | JSONB | posição, rotação, FOV (formato definido pelo viewport 3D) |
| `viewport_screenshot_url` | TEXT | screenshot do viewport 3D enviado pra IA |
| `prompt_extra` | TEXT NULL | "ajustes adicionais" da Tela 4 |
| `model_key` | TEXT | |
| `gcs_url` | TEXT | imagem gerada (personagem visto naquele enquadramento) |
| `state` | TEXT | `'favorita'` \| `'neutra'` \| `'descartada'` |
| `cost_actual` | NUMERIC(10,4) NULL | |

**`personagem_movimentos`** — etapa 3 do Fluxo D, vinculado a um enquadramento.

| coluna | tipo | nota |
|---|---|---|
| `parent_enquadramento_id` | UUID FK personagem_enquadramentos(id) ON DELETE CASCADE | |
| `motion_prompt` | TEXT | prompt de ação |
| `duration_s` | INT | duração escolhida |
| `model_key` | TEXT | i2v provider |
| `video_id` | UUID FK videos(id) NULL | quando gera, cria um row em `videos` com `origin='generated-from-character'` e referência cruzada. NULL durante geração. |
| `state` | TEXT | `'favorita'` \| `'neutra'` \| `'descartada'` |
| `cost_actual` | NUMERIC(10,4) NULL | |

> Por que vídeos do Fluxo D viram linha em `videos` também? Porque a visão diz que **o vídeo é o cidadão da workbench** (seção 4) — independente da origem, ele aparece em "Ateliê → Vídeos" e segue o mesmo fluxo de edição/publicação. `personagem_movimentos` é o "nó da árvore exploratória"; `videos` é a coisa que o editor abre. Os dois apontam um pro outro.

**`enquadramentos_avulsos`** — recurso da workbench independente de personagem (decisão da visão item 7: enquadramentos são reusáveis com qualquer personagem).

| coluna | tipo | nota |
|---|---|---|
| `owner_sub` | TEXT | |
| `name` | TEXT | |
| `camera_state` | JSONB | mesma estrutura de `personagem_enquadramentos.camera_state` |
| `viewport_screenshot_url` | TEXT NULL | |

> Distinção: `personagem_enquadramentos` é o **resultado gerado** (imagem do personagem específico naquele enquadramento). `enquadramentos_avulsos` é a **especificação de câmera reutilizável** sem imagem associada — tipo um preset rico. A visão item 7 ("um enquadramento pode ser usado com vários personagens") só faz sentido se ele existe independente — daí esta tabela. Na prática inicial talvez se use mais a primeira; manter as duas pra não quebrar a visão.

**`cameras_salvas`** — preset de câmera (visão seção 4: "Câmera salva").

| coluna | tipo | nota |
|---|---|---|
| `owner_sub` | TEXT | preset é do usuário |
| `name` | TEXT | |
| `camera_state` | JSONB | posição, rotação, FOV |

### 2.3 Tabelas da Galeria (compartilhadas)

**`projects`**

| coluna | tipo | nota |
|---|---|---|
| `owner_sub` | TEXT | quem criou; usado só pra "criado por X" no UI |
| `name` | TEXT | |
| `description` | TEXT NULL | |

**`project_members`** — quem tem acesso ao projeto.

| coluna | tipo | nota |
|---|---|---|
| `project_id` | UUID FK projects(id) ON DELETE CASCADE | |
| `member_sub` | TEXT | sub do Logto |
| `member_email` | TEXT | denormalizado pra exibir lista de membros |
| `role` | TEXT | `'owner'` \| `'member'`. v1: owner pode adicionar/remover membros, member não. |
| `added_by` | TEXT | sub de quem adicionou |
| `added_at` | TIMESTAMPTZ | |
| UNIQUE | `(project_id, member_sub)` | |

Quem cria um projeto entra automaticamente como `role='owner'` na mesma transação.

**`assets`** — entregável publicado, vive dentro de um projeto.

| coluna | tipo | nota |
|---|---|---|
| `project_id` | UUID FK projects(id) ON DELETE CASCADE | |
| `video_id` | UUID FK videos(id) ON DELETE RESTRICT | 1:1; deletar vídeo com asset publicado é bloqueado, força despublicar antes |
| `owner_sub` | TEXT | quem publicou (artista). Pra exibir "publicado por X". |
| `name` | TEXT | herda do vídeo na primeira publicação; renomeável depois |
| `status` | TEXT | `'pending'` \| `'done'`. Default `'pending'`. Renomeáveis no futuro (visão decisão 10). |
| `gcs_path`, `gcs_url` | TEXT | `.aseprite` final |
| `version` | INT | incrementa a cada republicação. Path no GCS leva o número (ver seção 3). |

> Constraint: `UNIQUE(video_id)` reforça a regra 1:1 da visão (decisão 5). Pra reusar em outro projeto, **duplica o vídeo na workbench** primeiro.

### 2.4 Estado "favorita" sem botão dedicado

A visão decide que descarte/favorito são **estados implícitos**, não ações do artista. Implementação:

- **Favorita** = última variação criada com sucesso da etapa, ou a que o artista clicou pra usar como pai de uma etapa seguinte. UI atualiza `state='favorita'` automaticamente, demais viram `'neutra'`.
- **Descartada** = só vira `'descartada'` se houver botão explícito de descartar (talvez não exista no v1).
- Coluna `cover_aparencia_id` em `personagens` materializa qual aparência aparece como capa — ressincronizada quando favorita muda.

> Implementação simples: trigger ou lógica no app garante que só uma variação por etapa+pai tem `state='favorita'` por vez. Optar por **lógica no app** (atomic update na transação que cria nova variação ou troca seleção) — sem trigger.

### 2.5 Permissões

- **Recursos da workbench** (videos, personagens, aparencias, enquadramentos, movimentos, enquadramentos_avulsos, cameras_salvas): visíveis e editáveis **só pelo owner_sub**. Workbench é privada, sempre.
- **Projetos** e seus assets: visíveis e editáveis por qualquer linha em `project_members` daquele projeto. v1 sem distinção de papel além de "quem é owner pode adicionar/remover membros".
- **Listar projetos do usuário:** `JOIN project_members WHERE member_sub = $1`.
- **Acessar asset:** o usuário tem que ser membro do projeto (`assets.project_id IN (SELECT project_id FROM project_members WHERE member_sub = $1)`).
- **Publicar:** o vídeo tem que ser do `owner_sub` do publicador, e o projeto tem que ter o publicador como membro. A primeira publicação cria o `asset`; republicações sobrescrevem o GCS e incrementam `version`.

### 2.6 Resolução de FK polimórfica em `videos.source_enquadramento_id`

Vídeo do Fluxo D pode ter sido gerado a partir de `personagem_enquadramentos` (enquadramento específico daquele personagem) ou `enquadramentos_avulsos` (enquadramento reusável sem imagem). Resolução: **coluna adicional `source_enquadramento_kind` TEXT** = `'personagem'` \| `'avulso'`. Joins ficam explícitos. Banco aceita ambas as FKs como `NULL`-ables — só uma é preenchida.

Alternativa mais simples se na prática só usar `personagem_enquadramentos`: ignorar `enquadramentos_avulsos` no v1, deixar a tabela vazia. Implementar quando precisar.

## 3. Storage no GCS

Bucket: `didlu-imagestore`. URL: `https://st.did.lu/<path>`.

Convenção de paths sob `roto-master/`:

```
roto-master/
  videos/<video_id>/source.<ext>            — vídeo bruto (upload, URL baixada, ou gerado)
  videos/<video_id>/thumb.jpg               — thumbnail (gerada server-side; futuro)

  assets/<asset_id>/v<N>/<asset_id>.aseprite — N = assets.version, incrementa a cada republish

  personagens/<personagem_id>/aparencias/<aparencia_id>.png
  personagens/<personagem_id>/enquadramentos/<enquadramento_id>.png
  personagens/<personagem_id>/enquadramentos/<enquadramento_id>-viewport.png
```

Regras simples:
- **Vídeo bruto:** upload uma vez, nunca muda. Se o usuário re-up, é vídeo novo (entry novo em `videos`).
- **Aparência/enquadramento gerado:** imutável. Variação nova = arquivo novo (UUID novo).
- **`.aseprite`:** republicar incrementa `assets.version` e sobe em path novo. Versões antigas permanecem no bucket (visão decisão 6: "republicar sobrescreve, sem histórico" — interpretado como "UI não mostra versões antigas"; o bucket as mantém só pra recuperação manual se precisar).

Acesso: URL pública direta, sem rota intermediária. Time interno, sem ameaça de URL adivinhada (UUID v4).

## 4. Endpoints REST

Padrão atual mantido: rotas montadas em `routes/<entidade>.js`, todas atrás de `requireUser`, retornando `{ <entidade> }` ou `{ <entidades> }`.

### 4.1 Workbench (escopo `owner_sub`)

```
GET    /api/videos                    lista vídeos do usuário
POST   /api/videos                    cria entry vazio (origem='uploaded')
GET    /api/videos/:id                detalhe
PATCH  /api/videos/:id                renomear, atualizar edit_state, marcar source_*
DELETE /api/videos/:id                deleta (RESTRICT se tem asset publicado)
POST   /api/videos/:id/upload         multipart, sobe pro GCS, atualiza gcs_*, size_bytes, etc.
POST   /api/videos/:id/duplicate      duplica row + arquivo no GCS, sai sem published_asset_id

GET    /api/personagens
POST   /api/personagens               cria sem nome
GET    /api/personagens/:id
PATCH  /api/personagens/:id           rename, troca cover
DELETE /api/personagens/:id           CASCADE em aparencias/enquadramentos/movimentos
POST   /api/personagens/:id/aparencias    cria job de geração; retorna job_id
POST   /api/personagens/:id/enquadramentos cria job (precisa parent_aparencia_id no body)
POST   /api/personagens/:id/movimentos    cria job (precisa parent_enquadramento_id)
PATCH  /api/aparencias/:id            muda state, prompt
PATCH  /api/enquadramentos/:id        idem
PATCH  /api/movimentos/:id            idem
                                       (tabelas separadas, rotas separadas)

GET    /api/cameras                   lista cameras_salvas
POST   /api/cameras                   cria
DELETE /api/cameras/:id

GET    /api/jobs                      lista jobs do usuário (filtra por status, kind)
GET    /api/jobs/:id                  detalhe + result/error
POST   /api/jobs/:id/retry            clona o job com mesmos params, status='queued'
```

### 4.2 Galeria (escopo `project_members`)

```
GET    /api/projects                  lista projetos do user (JOIN project_members)
POST   /api/projects                  cria + insere creator como owner
GET    /api/projects/:id              detalhe + assets + members
PATCH  /api/projects/:id              rename
DELETE /api/projects/:id              CASCADE em assets; só owner

POST   /api/projects/:id/members      adiciona por email; só owner pode
DELETE /api/projects/:id/members/:sub remove; só owner pode

GET    /api/assets                    lista assets de projetos do user (filtros: project_id, status)
GET    /api/assets/:id
PATCH  /api/assets/:id                rename, troca status
POST   /api/assets/:id/publish        regenera .aseprite, incrementa version, atualiza gcs_url
                                      (criação inicial é via POST /api/videos/:id/publish)
POST   /api/videos/:id/publish        primeira publicação: body { project_id, asset_name? }
                                      cria asset, gera .aseprite, atualiza video.published_asset_id
```

### 4.3 Catálogo

```
GET    /api/models                    lista models enabled (com step, cost_per_unit, params_schema)
                                       sem auth especial; UI consome pra montar dropdowns
```

## 5. Jobs assíncronos (geração de IA)

A visão impõe três restrições:
1. Geração de vídeo é longa (~60s); não bloqueia UI.
2. Falhas têm botão "tentar novamente com os mesmos parâmetros".
3. Custo é mostrado antes; cobrado de verdade depois.

### 5.1 Tabela `jobs`

| coluna | tipo | nota |
|---|---|---|
| `owner_sub` | TEXT | |
| `kind` | TEXT | `'generate-appearance'` \| `'generate-framing'` \| `'generate-motion'` \| `'download-from-url'` (futuro) |
| `status` | TEXT | `'queued'` \| `'running'` \| `'completed'` \| `'failed'` |
| `params` | JSONB | tudo que foi enviado: prompt, model_key, parent_id, camera_state, etc. |
| `result` | JSONB NULL | `{ aparencia_id }`, `{ enquadramento_id }`, `{ movimento_id, video_id }`, etc. |
| `error_message` | TEXT NULL | pra exibir no UI |
| `provider_job_id` | TEXT NULL | id externo no fal.ai/etc. quando aplicável |
| `cost_estimated` | NUMERIC(10,4) | mostrado no UI antes de criar |
| `cost_actual` | NUMERIC(10,4) NULL | preenchido ao terminar |
| `started_at`, `completed_at` | TIMESTAMPTZ NULL | |

Índices: `(owner_sub, created_at DESC)`, `(status, created_at)` pra worker.

### 5.2 Worker

Arquivo `worker.js` no mesmo container, iniciado em paralelo ao `server.js` (ambos via `npm start` que vira `node server.js & node worker.js`). Loop simples:

```
while true:
  pega 1 job WHERE status='queued' ORDER BY created_at LIMIT 1 (FOR UPDATE SKIP LOCKED)
  se nada: sleep 2s, continua
  marca status='running', started_at=NOW()
  chama provider conforme kind
  se sucesso: cria as rows de domínio (aparencia, enquadramento, video, etc), status='completed', result=...
  se falha: status='failed', error_message=...
  loop
```

Concorrência: instância única no v1 (uma só VM, um só container). `FOR UPDATE SKIP LOCKED` deixa pronto pra escalar pra múltiplos workers depois sem refatorar.

### 5.3 Cliente

- **Tela "Ateliê → Gerações"** — quinta subseção da sidebar do Ateliê. Lista cronológica de jobs do usuário. Ativos no topo, falhas com botão retry, completos como histórico.
- **Indicador no header global** — badge com contador de jobs `running` + `failed-não-vistos`. Clicar leva pra subseção.
- **Polling** — quando há jobs `queued` ou `running` do usuário, frontend faz `GET /api/jobs?status=queued,running` a cada 3s. Quando algum vira `completed`/`failed`, dispara toast e refresca a tela relevante (ex: aparência nova aparece na coluna).

### 5.4 Retry

`POST /api/jobs/:id/retry` clona a row: novo `id`, mesmos `params`, `status='queued'`, `error_message` da tentativa anterior preservada como referência (`metadata.previous_attempt_id`). Job antigo continua existindo no histórico.

## 6. Catálogo de modelos

### 6.1 Tabela `models`

| coluna | tipo | nota |
|---|---|---|
| `key` | TEXT PK | ex: `'nano-banana-pro'`, `'kling-i2v'` |
| `name` | TEXT | rótulo no UI |
| `step` | TEXT | `'appearance'` \| `'framing'` \| `'motion'` |
| `provider` | TEXT | `'google'`, `'fal-kling'`, `'fal-hailuo'` |
| `cost_per_unit` | NUMERIC(10,4) | |
| `unit` | TEXT | `'per_call'` \| `'per_second'` |
| `default_params` | JSONB | parâmetros default (estilo, duração default, etc.) |
| `enabled` | BOOLEAN | desabilitar sem deploy |

Seed inicial via SQL na migration. Adicionar modelo novo = INSERT (futuro: admin no `admin.did.lu`).

### 6.2 Cálculo de custo

UI:
- `unit='per_call'`: mostra `cost_per_unit` direto.
- `unit='per_second'`: mostra `cost_per_unit × duração_escolhida` em tempo real.

Cobrança real: `cost_actual` é preenchido pelo worker ao receber resposta do provider (ou estimado igual se provider não retornar custo exato).

## 7. Hierarquia de prompt (constantes invisíveis)

Visão item 4 + módulo personagem seção 4.1. Constantes técnicas obrigatórias **não são guardadas no banco**, são montadas pelo worker no momento da chamada à IA. Razão: se alterar a constante, queremos que valha pra gerações futuras sem precisar atualizar dados antigos.

Localização: `lib/prompts.js` no backend. Função `buildPrompt(step, userInput)` retorna string final enviada ao provider.

## 8. Fluxo de publicação (transação atômica)

Primeira publicação (`POST /api/videos/:id/publish`):

```
BEGIN
  valida: video.owner_sub = req.user.sub
  valida: req.user.sub é membro de project_id
  valida: video.published_asset_id IS NULL (senão é republicação, rota errada)
  gera .aseprite no servidor (ou recebe blob do cliente — decisão de implementação)
  sobe pro GCS em assets/<novo_asset_id>/v1/<novo_asset_id>.aseprite
  INSERT assets (project_id, video_id, owner_sub, name, status='pending', gcs_url, version=1)
  UPDATE videos SET published_asset_id = <novo_asset_id>
COMMIT
```

Republicação (`POST /api/assets/:id/publish`):

```
BEGIN
  valida membership
  busca video associado (asset.video_id)
  gera .aseprite atualizado
  sobe pro GCS em assets/<asset_id>/v<N+1>/<asset_id>.aseprite
  UPDATE assets SET version = N+1, gcs_url = <nova URL>
COMMIT
```

Geração do `.aseprite`: por enquanto **no cliente** (writer já existe em `public/js/aseprite.js`), cliente faz upload do blob. Futuro pode mover pro servidor; não muda nada na arquitetura.

## 9. Frontend

Estrutura dos módulos ES atual (`public/js/`) cresce pra refletir as áreas:

```
public/js/
  main.js               bootstrap (auth → router)
  auth.js, videos_api.js, ...   (existentes, mantidos)
  api/
    projects.js, assets.js, personagens.js, jobs.js, models.js
  ui/
    galeria/
      home.js              lista de projetos
      projeto_detail.js    lista de assets
    atelie/
      shell.js             sidebar com 5 subseções
      videos.js
      personagens.js
      enquadramentos.js
      cameras.js
      geracoes.js          lista de jobs
    editor/                (existente, evoluir)
    publish_modal.js       ato de publicar
    flow_picker.js         seletor de fluxo A/B/C/D
  state/
    space.js               'galeria' | 'atelie' (alternador)
    polling.js             gerencia poll de /api/jobs enquanto há ativos
```

Roteamento hash:

```
#/                           → galeria (home, lista de projetos)
#/p/:project_id              → galeria, detalhe do projeto
#/a/:asset_id                → detalhe do asset (modal? tela? decisão da UI)
#/atelie                     → ateliê, default = vídeos
#/atelie/videos
#/atelie/personagens
#/atelie/personagens/:id     → workspace do personagem (3 colunas)
#/atelie/enquadramentos
#/atelie/cameras
#/atelie/geracoes
#/v/:video_id                → editor (já existe)
```

Alternar Galeria↔Ateliê: troca de prefixo da rota + transição animada (~500ms, herdada do protótipo).

## 10. Migrations planejadas

Uma por mudança coesa, em ordem alfabética automática:

```
001_videos.sql                        já existe (não mudar)
002_videos_workbench_columns.sql      ALTER TABLE videos: origin, published_asset_id (FK pendente),
                                       source_aparencia_id, source_enquadramento_id,
                                       source_enquadramento_kind, source_motion_prompt, source_model_key
003_projects.sql                      tabela projects + project_members
004_assets.sql                        tabela assets, FK videos.published_asset_id, UNIQUE(video_id)
005_personagens.sql                   personagens, personagem_aparencias,
                                       personagem_enquadramentos, personagem_movimentos
006_enquadramentos_avulsos.sql        tabela enquadramentos_avulsos
007_cameras_salvas.sql                tabela cameras_salvas
008_jobs.sql                          tabela jobs + índices
009_models.sql                        tabela models + seed (nano-banana-pro, kling-i2v, hailuo-i2v)
```

Detalhe de cada migration vem nos próprios arquivos `.sql` quando forem escritos.

## 11. O que NÃO está nesta arquitetura (e por quê)

- **Service workers, offline mode** — desnecessário, time interno usa online sempre.
- **Histórico de versões de asset com UI** — visão decisão 6: republicar sobrescreve. Versões antigas ficam no bucket por acidente, não como feature.
- **Rate limiting, auditoria detalhada** — time pequeno fechado.
- **Soft delete generalizado** — só onde tem semântica (estado `'descartada'` nas variações). Resto é DELETE direto.
- **Cache de respostas** — sem necessidade no v1; Postgres aguenta a carga de um time pequeno.
- **GraphQL, tRPC, etc.** — REST direto, fim.
- **Testes automatizados extensivos** — projeto exploratório; teste manual + smoke test em produção bastam por enquanto.

## 12. Próximos passos

1. Escrever as migrations 002–009 conforme seção 10.
2. Implementar a UI espelhando o protótipo v2 (galeria/ateliê com transição animada).
3. Upload de vídeo pro GCS (rota `POST /api/videos/:id/upload`).
4. Endpoints de projects + assets + ato de publicar.
5. Worker + endpoints de jobs + tela de Gerações.
6. Fluxo D (módulo personagem) completo, reaproveitando viewport 3D do `prototype-v1-personagem/`.

Cada passo: incrementa `PROGRESS.md`, deploy via `bash /home/manu/platform/scripts/deploy.sh roto-master`.

## 13. Documentos relacionados

- `docs/visao-da-ferramenta.md` — fonte de verdade de produto. **Vence em qualquer conflito.**
- `docs/modulo-personagem.md` — especialização do Fluxo D.
- `prototype/` — protótipo v2 aprovado, modelo de referência da UI.
- `prototype-v1-personagem/` — protótipo v1, reaproveitar viewport 3D + estética Atelier 2087.
- `PROGRESS.md` — estado vivo da implementação.
