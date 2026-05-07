# PROGRESS — roto-master

Última atualização: 2026-05-08 — **Frames Editor implementado em uma sessão (back + front), pendente smoke test do user com banco/túnel ativo.** Em paralelo: PixVerse V6 entrou como segundo provider de vídeo (commit `6fcb1dc`). Frames Editor pousou em ~10 commits, dois agentes em worktree (parser/writer e UI) rodando em paralelo enquanto a main fazia migration + back. Status concreto na seção "Estado da implementação do Frames Editor (2026-05-08)" abaixo. **Falta:** smoke test com user usando, integração Frames Editor ↔ Assets (task #9 — "Editar como tirinha" no card do asset, "Publicar como novo asset" no editor).

## Estado da implementação do Frames Editor (2026-05-08)

### Entregue end-to-end

**Banco** — `migrations/017_frame_editor.sql` (commit `d4d4888`) com 4 tabelas `fe_*`: `fe_tirinha`, `fe_camada`, `fe_quadro`, `fe_celula`. Conforme `docs/frame-editor/modelo-de-dados.md` (alinhado em commit `671612b` pra refletir 3 ajustes feitos no schema vs. doc original: `fe_tirinha.largura/altura NOT NULL`, `fe_tirinha.last_aseprite_url`, `fe_celula.estado/estado_erro/estado_atualizado_em`). Sem `owner_*`. Sem FK pra `videos`/`assets`/`projects` (desacoplamento estrutural).

**Backend** — `routes/fe.js` plugado em `/api/fe/*` (commit `a96d5e1`):
- Tirinhas: GET/POST/PATCH/DELETE. POST tem 3 variantes (`vazia`/`upload`/`asset`); variantes `upload`/`asset` aceitam `{camadas, quadros, celulas}` enviadas pelo front (que já parseou o `.aseprite`) e criam C×Q células em transação.
- Camadas: POST cria células vazias cruzando todos os quadros existentes. PATCH com reordenação consciente da `UNIQUE(tirinha_id, ordem)` (slot temporário negativo pra evitar conflito).
- Quadros: POST com reindexação. DELETE cascade + reindexa subsequentes.
- Células: PATCH pra trocar/limpar `png_url`.
- Upload: `POST /upload-png` (multipart, valida magic bytes do PNG, extrai largura/altura do IHDR) e `POST /upload-aseprite` (atualiza `last_aseprite_url` da tirinha).

**IA assíncrona** — `lib/fe-prompts.js` + endpoint `POST /api/fe/prompts` (commit `8869452`):
- Provider real escolhido: **Fal.ai `nano-banana-pro/edit`** (reusa `lib/providers/fal.js` que o resto da plataforma já usa; mesma `FAL_KEY`). `docs/frame-editor/ia.md` §4 atualizado em `c4076cc` pra refletir.
- Marca células alvo como `processando` em transação, devolve 202 imediato com `job_id` + `celulas_marcadas`. Fire-and-forget pro lote.
- Concorrência limitada (`CONCURRENCY=3`). Erro per-célula não aborta o lote (volta a `idle` com `estado_erro` preenchido). Sem retry, sem cancelamento, sem cache (alinhado com `ia.md` §7-9).
- Coerência entre quadros vizinhos não é tratada arquiteturalmente — responsabilidade do user.

**Parser/writer `.aseprite` genérico** — `public/js/aseprite_io.js` (commit `0742331`, mergeado em `dbad9cc`):
- Módulo ES novo, separado do `aseprite.js` antigo (que tem layout fixo `ref`/`draw` e continua sendo consumido pelo editor de rotoscopia em prod). Não regrediu nada.
- `parseAsepriteParaFrameEditor(arrayBuffer)` → `{largura, altura, camadas, quadros, celulas}` (composita os cels de cada interseção num único PNG RGBA do tamanho do canvas).
- `buildAsepriteDoFrameEditor(estrutura)` → `Uint8Array` (RGBA, cels comprimidos zlib via `pako`). Células vazias → nenhum cel chunk emitido.
- Round-trip funciona; perde tags/slices/paths/tween/groups/tilemaps (fidelidade parcial assumida em `aseprite-io.md` §5).
- Função `_test()` exportada com 3 cenários de round-trip.

**UI das duas telas** — Tela 1 (`#/fe`) e Tela 2 (`#/fe/t/:id`), commit `f3adca1`:
- `public/js/fe_api.js` cliente das rotas. `public/js/fe_home.js` Tela 1 (grid de cards + modal "nova tirinha" com 3 origens — vazia, upload `.aseprite` com parsing local + upload célula a célula, importar de asset desabilitado/em breve). `public/js/fe_editor.js` Tela 2 (canvas read-only com zoom 4× default e controles +/-, matriz camadas×quadros, seleção célula/coluna/linha/múltipla via shift+click e ctrl+click, botões prompt-pra-todos e prompt-pros-selecionados, +camada/+quadro, download `.aseprite` que gera local + sobe via `/upload-aseprite`, polling 3s enquanto há célula `processando`).
- **Identidade visual própria**: ciano-elétrico (`#4dd9d6`) sobre grafite-frio (`#07080b`–`#232a3a`) com violeta (`#9070f0`) como cor de estado processando. Variáveis escopadas em `[data-space="frame-editor"]` em `public/styles.css`. Distinto do cobre+ink das outras duas áreas.
- Alternador ternário no header (Galeria | Ateliê | Frames Editor); `chrome.js` ajustado pra slidar a thumb pra 0/33/66%.
- Anti-padrões respeitados (ui.md §5): sem pintura no canvas, sem undo, sem presets nomeados de IA tipo "estilizar/limpar", sem botão "salvar", sem filtros "minhas tirinhas", só modais custom.

### Cobertura de tasks

| # | Task | Status |
|---|---|---|
| 1 | Commit + push das mudanças pendentes | ✅ |
| 2 | Migration `fe_*` | ✅ commit `d4d4888` |
| 3 | Estender parser/writer `.aseprite` | ✅ commit `0742331` (agente paralelo) |
| 4 | CRUD backend `/api/fe/*` | ✅ commit `a96d5e1` |
| 5 | Upload PNG + GCS path | ✅ commit `a96d5e1` |
| 6 | Endpoint de prompt + IA assíncrona | ✅ commit `8869452` |
| 7 | Live updates | ✅ via polling de 3s; SSE fica pra rodada própria quando virar problema |
| 8 | UI Tela 1 + Tela 2 | ✅ commit `f3adca1` (agente paralelo) |
| 9 | Integração com Assets ("Editar como tirinha" / "Publicar como novo asset") | ⏸ pendente |

### Decisões pendentes / não-fechadas

- **Smoke test com user** — eu validei localmente que o servidor sobe, serve os JS novos, e que `/api/fe/tirinhas` chega no handler (devolveu 500 esperado porque túnel IAP pro Postgres da VM não estava aberto na hora do teste). Falta o user abrir o túnel via `scripts/dev.cmd` e exercitar a UI ponta-a-ponta.
- **Migration 016** (PixVerse) e **017** (frame-editor) entram automaticamente no próximo `deploy.sh roto-master` via `STEP 3`. Em local, aplicar manualmente quando o user abrir o túnel.
- **Integração Frames Editor ↔ Assets (task #9)** — duas pontes documentadas em `docs/frame-editor/integracao-com-assets.md`: (a) botão "Editar como tirinha" no card do asset (área Assets ganha capacidade de expor `.aseprite` original-da-quebra e/ou final por asset; modal de escolha quando há os dois); (b) `POST /api/fe/tirinhas/:id/publicar-asset` que cria asset novo na área Assets a partir do `.aseprite` da tirinha — sem vínculo vivo (princípio §4.4 do doc). Asset no schema atual tem 1:1 com `video_id`; a publicação a partir do Frames Editor precisa ou (i) criar um vídeo placeholder, ou (ii) relaxar a constraint pra aceitar asset sem vídeo. Decisão de produto pendente.
- **`docs/visao-da-ferramenta.md` raiz** continua desatualizado em relação à v7 e a esta rodada de implementação. Fica pra rodada própria.
- **`docs/arquitetura-tecnica.md` raiz** continua desatualizado. Mesma rodada que o anterior.

### Arquivos novos/modificados nesta rodada (lista direta)

**Banco:** `migrations/016_pixverse_models.sql`, `migrations/017_frame_editor.sql`.

**Backend:** `routes/fe.js` (novo, ~620 linhas), `lib/fe-prompts.js` (novo, ~110 linhas), `lib/providers/fal.js` (PixVerse), `routes/generate.js` (PixVerse), `server.js` (mount `/api/fe`).

**Frontend:** `public/js/aseprite_io.js` (novo, ~530 linhas), `public/js/fe_api.js` (novo, ~170 linhas), `public/js/fe_home.js` (novo, ~320 linhas), `public/js/fe_editor.js` (novo, ~640 linhas), `public/js/router.js`, `public/js/chrome.js`, `public/js/main.js`, `public/index.html`, `public/styles.css`.

**Docs:** `docs/visao-da-ferramenta.md` (patch v7), `docs/frame-editor/visao.md` (novo), `docs/frame-editor/modelo-de-dados.md` (novo + ajuste pós-migration), `docs/frame-editor/storage.md` (novo), `docs/frame-editor/aseprite-io.md` (novo), `docs/frame-editor/ia.md` (novo + ajuste pós-implementação), `docs/frame-editor/api.md` (novo), `docs/frame-editor/ui.md` (novo), `docs/frame-editor/integracao-com-assets.md` (novo).

---

## Última atualização anterior: 2026-05-07 noite (terceira atualização) — **detalhamento técnico do Frames Editor pousou em pasta própria (`docs/frame-editor/`).** A discussão técnica que ficara pra outro contexto na atualização anterior aconteceu nesta sessão pra **uma das três áreas — o Frames Editor** — e fechou em 8 docs conceituais (visão + 7 docs técnicos), totalmente desacoplados do resto. Decisões estruturais novas em relação à v7: (a) Frames Editor **tem entidade própria no banco** (não é stateless — regressão corrigida em conversa); a versão 1 do `frame-editor.md` que dizia o contrário foi reescrita; (b) **cache de IA não existe** — resultado de IA é PNG normal no GCS, fim; (c) **pixel não vive no banco** — banco guarda referência ao PNG, edição "por cima" cria camadas novas, não rescreve pixels; (d) **varredura/limpeza GCS sai do MVP** — fica pra rodada própria quando virar problema real; (e) **`.aseprite` exportado é on-demand**, mantém só o último por tirinha, sem geração proativa. Outras três áreas (Assets, Frames Creator, atualização do `arquitetura-tecnica.md` raiz) não foram tocadas nesta rodada — continuam como estavam.

Última atualização anterior: 2026-05-07 noite (segunda atualização) — **discussão conceitual pousou no patch v7 da visão.** A ferramenta passa a ser organizada em **três áreas macro irmãs**: **Assets** (entrega), **Frames Creator** (renomeação do Ateliê — produção a partir de vídeo, com **tirinha** elevada a entidade nomeada), **Frames Editor** (área macro nova, isolada, comunica com o resto só via arquivo `.aseprite`). Decisão estrutural fechada: **nada na plataforma é do usuário** — tudo coletivo, banco como única fonte da verdade. Ciclo com artista é **não-linear** (`.aseprite` vai e volta entre Aseprite desktop, Frames Editor, e re-edição do vídeo, em qualquer ordem). Dois modos de exportação do `.aseprite`: como referência (modelo atual) ou como arte final. Documentos atualizados/criados nesta sessão: `docs/visao-da-ferramenta.md` (patch v7), `docs/frame-editor.md` (novo, escopo macro mínimo). **Discussão técnica** (modelo de dados pra tirinha, padrão GCS pra quadros, varredura/limpeza, isolamento real do Frames Editor) **fica pra próxima conversa em outro contexto** com estes docs como entrada. Núcleo da v1 em produção continua válido e correto — esta rodada é extensão, não pivot.

Última atualização anterior: 2026-05-07 noite — **abertura conceitual da ferramenta em discussão.** Conversa com user revelou que a ferramenta tem alcance maior do que "rotoscopia clássica": estilização IA frame-a-frame habilita casos como pintar em cima da arte da IA, editar a referência diretamente, usar o `.aseprite` daqui como sandbox antes do Aseprite desktop. Patch v5 da visão (nova **seção 13** em `docs/visao-da-ferramenta.md`) abre o conceito como "plataforma de produção 2D quadro-a-quadro a partir de vídeo, com camadas opcionais e composição flexível". Discussão **não fechou** — 8 perguntas em aberto na 13.6, a continuar 2026-05-08+. **Não implementar nada da abertura enquanto não pousar.** Núcleo da v1 em produção continua válido e correto.

## Detalhamento técnico do Frames Editor (2026-05-07 noite, terceira parte)

### O que foi feito

`docs/frame-editor.md` (raiz) movido pra `docs/frame-editor/visao.md`. Pasta `docs/frame-editor/` criada com **8 docs conceituais** que cobrem todas as decisões estruturais da área pra entrar em implementação:

1. **`visao.md`** — escopo macro, princípios. Reescrita ampla nesta sessão pra corrigir regressão (versão anterior dizia "stateless / sem entidade no banco" — errado, é editor online com estado vivo no banco).
2. **`modelo-de-dados.md`** — 4 entidades (`fe_tirinha`, `fe_camada`, `fe_quadro`, `fe_celula`). Prefixo `fe_` separa do resto. Célula = interseção camada×quadro com referência a UM PNG no storage. Sem pixel-no-banco. Sem `owner_*`. Cardinalidade de `fe_celula` é sempre C×Q (célula vazia = `png_url = NULL`).
3. **`storage.md`** — GCS no bucket existente (`didlu-imagestore`), servido via `st.did.lu`. Path versionado por hash+data pra cache-busting. **Substituição = arquivo novo com path novo**. `.aseprite` exportado é on-demand, mantém só o último por tirinha. **Varredura saiu do MVP** — PNGs antigos e `.aseprite` substituídos ficam no bucket sem regra ativa de remoção; quando virar ruído, decisão entra em rodada própria.
4. **`aseprite-io.md`** — parsing/geração no front (JS puro, sem binário no servidor). Mapeamento 1-pra-1 com entidades. **Exportação fiel ao estado** (sem "modos" — modos são responsabilidade de outras áreas, não do Frames Editor). Fidelidade parcial assumida (tags, slices, groups, tween ignorados).
5. **`ia.md`** — IA no servidor. Provider padrão **OpenAI Images (gpt-image-1 / 2.0)**, configurável (Fal.ai como alternativa se ficar mais barato). **Tudo assíncrono desde o MVP** — caminho único, 1 célula ou 200 segue mesmo fluxo. **Estado "processando" no banco**, não só na UI. Uma chamada por célula. **Sem retry, sem cancelamento, sem cache, sem quota.** Coerência entre quadros não é tratada arquiteturalmente.
6. **`api.md`** — REST simples, prefixo `/api/fe/`, JSON + multipart, `APP_TOKEN` no header. Endpoints por entidade + endpoints de processo (prompts, exportação, publicação). `POST /api/fe/prompts` devolve rápido com `job_id` e `celulas_marcadas`. **Live updates como contrato conceitual** (mecanismo concreto — SSE/WS/polling — fica pra implementação). `publicar-asset` não cria vínculo entre tirinha e asset.
7. **`ui.md`** — duas telas (lista de tirinhas + editor da tirinha). Editor = canvas + matriz camadas×quadros. **Canvas read-only no MVP** (sem pintura). 3 ações principais: prompt pra todos, prompt pros selecionados, criar quadro/camada. User não bloqueia durante processamento. **8 anti-padrões específicos** listados. 4 fluxos de uso documentados.
8. **`integracao-com-assets.md`** — único doc da pasta que toca outra área. **Apenas dois pontos de contato:** "Editar como tirinha" (Asset → Frames Editor) e "Publicar como novo asset" (Frames Editor → Asset). Ambos são **cópia consciente, sem vínculo vivo**. Publicar mesma tirinha duas vezes = dois assets distintos. 6 anti-padrões de integração explicitamente listados.

### Decisões estruturais novas (em relação ao patch v7 anterior)

1. **Frames Editor tem entidade própria no banco.** Versão 1 da visão dizia "comunica via arquivo, sem estado interno" — interpretação errada do desacoplamento. Reescrita: desacoplamento é **por troca via arquivo**, não por ausência de estado. Frames Editor é editor **online com estado vivo e colaborativo**, conforme já estava decidido em conversas anteriores não pousadas em arquivo (regressão corrigida).
2. **Cache de IA não existe.** Item 8 da v7 (resultados de IA "imutáveis e cacheados") está obsoleto pelo entendimento desta sessão. Resultado de IA é PNG normal no GCS — sem tabela de cache, sem indexação por hash, sem worker de invalidação. Deve sair da decisão 24 da `visao-da-ferramenta.md` na próxima varredura dos docs raiz.
3. **Pixel não vive no banco.** Banco guarda referência ao PNG. Edição "por cima dos quadros" resolve com **camada nova**, não com versionamento granular de pixel.
4. **`.aseprite` é on-demand.** Sem job de fundo regenerando. Mantém só o último por tirinha. Substituído a cada novo "download" ou "publicar como asset".
5. **Varredura/limpeza GCS fica fora do MVP.** Decisão consciente — adicionar agora confunde o modelo. Quando virar ruído real (volume), decisão entra em rodada própria.
6. **Ownership: sem `owner_*` em qualquer tabela do Frames Editor.** Princípio "nada é do usuário" aplicado de origem.
7. **Modos de exportação saem do escopo do Frames Editor.** Item 6 da v7 (dois modos `ref`/`final`) pertence ao **Frames Creator** ou à área Assets, não ao Frames Editor. Frames Editor exporta fiel ao estado, sem reorganização.

### O que entra como entrada da implementação

Quem for implementar o Frames Editor lê a pasta `docs/frame-editor/` inteira. **Ordem sugerida de leitura:** `visao.md` → `modelo-de-dados.md` → `storage.md` → `aseprite-io.md` → `ia.md` → `api.md` → `ui.md` → `integracao-com-assets.md`.

**Ordem sugerida de execução:**
1. Migration com as 4 tabelas `fe_*` (`modelo-de-dados.md`).
2. Endpoints CRUD básicos de tirinha/camada/quadro/célula (`api.md` §3-6).
3. Upload de PNG e mecânica de path no GCS (`api.md` §6, `storage.md` §2-3).
4. Parsing/geração de `.aseprite` no front (`aseprite-io.md`).
5. Endpoint de prompt + processamento assíncrono no servidor (`api.md` §7, `ia.md`).
6. Live updates (mecanismo a escolher — `api.md` §8, `ia.md` §6).
7. UI da Tela 1 (lista) e Tela 2 (editor com matriz e canvas) (`ui.md`).
8. Integração com Assets (`integracao-com-assets.md`).

Cada etapa pode ser feita por agente independente lendo só os docs relevantes.

### O que ainda não foi feito (não confundir com fechado)

- **`docs/visao-da-ferramenta.md` raiz não foi atualizado** com as 7 decisões novas listadas acima. Tem inconsistência conhecida: item 8 das decisões v7 (cache de IA) e item 6 (modos de exportação ligados ao Frames Editor) estão desalinhados com a pasta `frame-editor/`. Pasta vence em conflito.
- **`docs/arquitetura-tecnica.md` raiz** continua desatualizado em relação à v7 e mais ainda em relação a esta rodada. Adiada pra rodada própria (já estava adiada na atualização anterior).
- **Outras duas áreas (Assets, Frames Creator) não receberam detalhamento equivalente.** Quando entrarem em rodadas próprias, recomenda-se replicar a estrutura de `docs/frame-editor/` (pasta dedicada com docs conceituais por dimensão).
- **Implementação não começou.** Esta sessão foi 100% conceito + arquivo. Próxima sessão (em outro contexto, com agentes) inicia a execução.

---

## Pouso da discussão conceitual (patch v7 — 2026-05-07 noite, segunda parte)

### Decisões estruturais fechadas

1. **Três áreas macro irmãs** no nível mais alto da navegação:
   - **Assets** (Galeria atual) — entrega.
   - **Frames Creator** (renomeação do Ateliê) — produção a partir de vídeo.
   - **Frames Editor** — edição direta de `.aseprite`, **área isolada**.

2. **Frames Editor é completamente desacoplado do resto.** Não conhece projetos, vídeos, tirinhas. Comunica-se exclusivamente via arquivo `.aseprite` (entra por upload manual ou atalho do asset; sai por download ou "salvar de volta no asset" que é equivalente a baixar+subir). Modelo de dados, UI e decisões internas são escopo próprio dele. Documentado em `docs/frame-editor.md`.

3. **Nada na plataforma é do usuário.** Toda visibilidade é coletiva. Quem tem o token vê e mexe em tudo. Banco é a única fonte da verdade. Princípio durável: **toda fricção que separa "meu" de "do outro" é antipattern**. Razão: time pequeno (~2 pessoas), burocracia de permissão custou tempo desproporcional comparado ao benefício real. Edição simultânea por múltiplos agentes na mesma tirinha é direção futura aceita pela arquitetura conceitual.

4. **Tirinha** elevada a entidade nomeada da Frames Creator, com identidade própria (propriedades fps/in/out/scale + seus quadros). Hoje 1 por vídeo; refazer pede modal de confirmação porque sobrescreve. Toggle "Rotoscopia" no editor de vídeo passa a se chamar **"Quadros"**.

5. **Ciclo com artista é não-linear.** Três caminhos paralelos pro `.aseprite` do asset: Aseprite desktop, Frames Editor, re-edição do vídeo. Em qualquer ordem, quantas vezes for necessário. Não há etapa "final".

6. **Dois modos de exportação do `.aseprite`**: como referência (camadas `ref`/`draw` modelo atual) ou como arte final (tirinha como camada principal já trabalhada). Escolha consciente na hora do download.

7. **GCS continua como storage**, com nomenclatura versionada na URL (cada mudança = URL nova). **Footprint visível e controlável** — saber quanto consome e ter mecanismo de varredura/limpeza, mesmo que manual no início. Direção: deleção de entidade na plataforma deve eventualmente cascatear pra varredura no GCS.

8. **Resultados de IA são imutáveis e cacheados** (mesma combinação de input já gerada não cobra de novo).

### Documentos atualizados / criados nesta sessão

- `docs/visao-da-ferramenta.md` — patch v7. Reescritas: 1 (definição), 2 (público + colaboração extrema), 3 (princípios), 4 (entidades — tirinha promovida), 5 (funcionalidades por área), 6 (UI — três áreas, anti-padrões atualizados), 7 (ciclo não-linear), 8 (durabilidade), 9 (decisões — 24 itens), 10 (adiados), 11 (docs/protótipos), 12 (próximos passos).
- `docs/frame-editor.md` — novo. Escopo macro mínimo: onde fica (3ª área), princípio fundador (desacoplamento total), formas de entrada/saída do `.aseprite`, capacidades antecipadas listadas em alto nível, lista do que não cobre (intencional).

### Acoplamentos mapeados (não corrigidos nesta rodada)

**Código:** o desacoplamento "do usuário" já foi feito no patch de auth simples de 2026-05-05 — código não usa mais `owner_sub`/`req.user.sub`. Sobrevivem só:
- HTML/CSS: nomenclatura "Ateliê" (textos, classes CSS, `data-space="atelie"`), tagline "**seu** espaço de fabricação", textos como "do seu Ateliê" / "guarda o histórico na sua workbench". Mudança puramente cosmética/textual + reorganização do alternador binário pra ternário.
- Arquivos JS: `atelie_videos.js`, `atelie_text2video.js`, `atelie_generate.js` — renomear pra `frames_creator_*` é viável, não-trivial.
- SQL: colunas `owner_sub`/`owner_email` nas migrations 001-007. Já NULL-able. Cicatriz histórica que pode permanecer.

**Documentação:** `arquitetura-tecnica.md` (24 ocorrências de "do usuário", "workbench do usuário", `owner_sub` como NOT NULL, etc.) precisa atualização ampla. **Adiada pra rodada própria.** `modulo-personagem.md` tem só ocorrências cosméticas ("do usuário" como autor de prompt) — não conflita estruturalmente.

### O que fica explicitamente pra próxima conversa

Tudo que é técnica concreta:

- Modelo de dados pra **tirinha** (tabela própria? coluna em vídeo? como guardar lista de quadros?).
- Padrão real de armazenamento dos quadros no GCS (PNG individual? atlas? cache local em IndexedDB?).
- Versionamento de quadros (variantes IA, edições manuais, etc.) — caso de exceção mas precisa caber.
- Endpoints de tirinha, endpoints de upload de `.aseprite` trabalhado de volta.
- Mecânica de cache de IA pra não pagar duas vezes.
- Worker assíncrono pra estilização em lote (placeholder em `migrations/008_jobs.sql` ainda não consumido).
- Varredura/limpeza do GCS por entidade.
- Atualização de `docs/arquitetura-tecnica.md` pra refletir o v7.
- Reorganização concreta da UI (alternador ternário, renomeação `atelie_*` → `frames_creator_*`, textos coletivos, novo módulo Frames Editor).
- Decisões internas do **Frames Editor** (modelo de dados, UI, integrações de IA, layout) — em rodada própria, lendo `docs/frame-editor.md` como entrada.

Estes documentos (visão v7 + frame-editor.md) são entrada da próxima conversa. Não voltar a discutir conceito sem motivo.

---

Última atualização anterior: 2026-05-07 (commit `a2d9f4f` — upload de trabalho final + preview animado da rotoscopia, desacoplamento asset↔vídeo fase 1, fix da lixeira via confirmModal stacking. Deploy via `did.ps1 deploy roto-master` do `~/ved/devops-workflow-2026`.)

## Estado atual em produção (2026-05-07)

**Em https://roto.did.lu** — `version.json: rotoscopy-preview`.

Fluxo de produção fechado: pessoa publica asset → baixa o `.aseprite` esqueleto (camada `ref` preenchida com vídeo, camada `draw` vazia) → rotoscopa no Aseprite desktop → sobe via `↥ subir trabalho final` no card ou modal → asset vira "feito" → card e modal mostram a rotoscopia animada (parser `.aseprite` em JS + canvas + timing real dos frames). Sem dependência de thumb-jpeg pré-gerada. Vídeo de referência continua mostrado em hover pra assets pendentes.

**Desacoplamento asset↔vídeo (fase 1, sem migration):** `DELETE /api/assets/:id` não toca mais em `videos.published_asset_id`. `GET /api/videos` JOIN com `a.deleted_at IS NULL` — vídeo só mostra "publicado em X" se tem asset ATIVO. `POST /api/videos/:id/publish` permite publicar de novo se único asset foi pra lixeira. Mensagens não mentem mais sobre "vídeo voltar a ser rascunho". Decisão pendente do user: drop de `UNIQUE(video_id) WHERE deleted_at IS NULL` (fase 2) e drop da coluna `videos.published_asset_id` (fase 3) — ambos requerem migration; ficaram pra próxima sessão.

**Fix sistêmico do `confirmModal`:** virou modal stacking (z-index 700, classe `modal-stacked`) que sobrepõe sem fechar o modal por baixo. Antes, qualquer handler de "deletar/jogar na lixeira" dentro de outro modal explodia silenciosamente porque `currentAsset` virava null antes do `await deleteAsset()` rodar. Aplica-se automaticamente aos `confirmModal` em `atelie_text2video.js`, `atelie_generate.js`, `gal_trash.js` — eles ganharam o conserto de graça.

**Parser `.aseprite` em JS:** `public/js/aseprite_parser.js` (~200 linhas, lê RGBA 32bpp, cels comprimidos zlib + raw, layers, durações). Heurística `pickRotoscopyLayer` escolhe a camada de índice mais alto com pixels não-transparentes (a "draw" no nosso writer). `public/js/rotoscopy_preview.js` orquestra fetch + parse + canvas com cache em memória + lazy loading via `IntersectionObserver` no card. Pode ser reusado pra qualquer manipulação futura de `.aseprite` (split, merge, troca de camada de referência, etc).

**Outros fixes da sessão:**
- Botão "Galeria"/"Ateliê" do header sempre vai pra raiz daquele espaço (antes early-return em `chrome.js:20` bloqueava se já estava no espaço, mesmo numa subseção).
- Vídeo no hover do card e modal de detalhe (substitui dependência de `thumb_url`).

---

Última atualização anterior: 2026-05-05 noite (auth simples — Logto/owner/membros removidos, token único compartilhado via `APP_TOKEN`. Commit `7290a4d`. `FAL_KEY` e `APP_TOKEN` no `.env` da VM. `deploy.sh` da VM consertado.)

## ⚠️ Auth simples (2026-05-05) — token único, sem owner

Decisão crítica: ferramenta interna, time pequeno (você + 1-2 pessoas), fricção de login custou tempo desproporcional (loops de redirect Logto, tokens expirando silenciosamente, autosave 401, sessões quebradas). Removido tudo de Logto/OAuth/owner/membros. Quem tem o `APP_TOKEN` vê e mexe em tudo.

**Token de prod:** vive em `/home/manu/platform/.env` da VM como `APP_TOKEN`. Pra compartilhar com alguém, mandar a string. No browser, cola no prompt que aparece — fica salvo em `localStorage` (key: `roto-master.token`). Pra resetar token salvo: botão "colar token" na tela de erro, ou `localStorage.removeItem('roto-master.token')` no devtools.

**Bypass dev local:** `.env` tem `DEV_BYPASS=1`. Backend pula validação de token, frontend manda string fake. Roda sem fricção.

**Schema:** colunas `owner_sub`/`owner_email` em `videos`/`projects`/`assets` ficaram (NULL-able) pra preservar dados existentes — código não lê/escreve mais nelas. Tabela `project_members` foi dropada (migration 014).

## ⚠️ Leitura obrigatória antes de continuar

### Ordem de leitura — não inverter

1. **`docs/visao-da-ferramenta.md`** — referência mestra. **Ler INTEIRO**. Em ordem de criticidade pra UI: seção 6.1 (metáfora Ateliê/Galeria), 6.5 (anti-padrões — lista do que NÃO pode aparecer), 6.7 (detalhe do asset, decisão fechada no patch v4), 6.6 (regra de validação). **Seção 13 (patch v5, 2026-05-07) — abertura conceitual em discussão. Ler antes de propor qualquer feature nova.**
2. **`docs/arquitetura-tecnica.md`** — espelho técnico. Régua: **time interno pequeno** — não inventar cerimônia de SaaS público.
3. **`docs/modulo-personagem.md`** — especialização do Fluxo D. Anterior à visão mestra; em conflito **vale a visão**.

### Cicatrizes de erros reais (não esquecer)

- **2026-05-04:** o segundo protótipo violou anti-padrões de UI por pular a seção 6. Patch v3 da visão nasceu desse erro. **Antes de produzir QUALQUER UI**, passar pelo checklist da seção 12 da visão. Se não passar, parar.
- **2026-05-04:** durante o trabalho da fatia mínima, ao tentar conversar com o user sobre decisões técnicas, deliri trazendo preocupações de produto público (membership pra prevenir vazamento, etc.) num contexto de time interno pequeno e fechado. Régua é "isso aparece porque é necessidade desta ferramenta ou porque é padrão de SaaS?". Se for o segundo, remover.
- **2026-05-04:** durante a v1, ignorei a definição de "Detalhe de asset" (seção 6.2 ponto 5) tratando como "decisão futura" e entreguei o asset card sem ação alguma. Resultado: o usuário publicou um asset e ficou olhando pra um card morto. Princípio "asset é cidadão central" quebrado. Patch v4 da visão fechou a decisão (modal, ver 6.7).
- **Asset é cidadão central**, não label técnico. Se entrar na ferramenta e não ver "isto é um asset" como objeto tangível e **interagível**, a UI errou.
- **2026-05-07:** ao discutir estilização IA frame-a-frame, o agente travou na leitura "ferramenta = rotoscopia clássica" e ofereceu opções que assumiam fluxo mandatório (estilização *substitui* a referência; estilização frame-a-frame ou por intervalo como modos de disparo; régua de seleção de range). User corrigiu enfaticamente: **(a)** nenhuma etapa substitui outra, todas são camadas paralelas opcionais (princípio gravado em memória `feedback_no_mandatory_flow.md`); **(b)** a leitura "ferramenta de rotoscopia" estava estreita — a ferramenta é mais ampla, e várias escolhas hoje implícitas (vídeo vira `ref`, `draw` sai vazia) deveriam ser opcionais. Resultado: patch v5 da visão (seção 13) abrindo o conceito pra discussão. **Lição:** quando aparecer dúvida sobre escopo, voltar à formulação da 13.2 ("matéria-prima de animação 2D quadro-a-quadro a partir de vídeo, com camadas opcionais"), não a "rotoscopia". E nunca propor opções que assumam que uma etapa substitui outra.

## Estado atual

**Em produção em https://roto.did.lu:** commit `773697d` (Fluxo D em prod, fixes de smoke test, env vars completas). Container saudável (recriado em 6s no último deploy).

Conteúdo em prod:
- **v1** completa (galeria, ateliê, editor, publish, membros).
- **Fluxo B** completo (vídeo de URL/YouTube): cola URL → streaming → "extrair trecho" gera novo vídeo no GCS.
- **Fluxo C** completo (geração genérica): prompt → imagem (Nano Banana Pro) → vídeo (Kling 2.5 Turbo Pro i2v).
- **Fluxo D** completo (texto → vídeo): texto → vídeo direto (sem etapa intermediária de imagem).
- **UX:** botão voltar no editor, nome inline editável, loading do vídeo, thumb (1º frame), context menu no asset, "melhorar prompt" via Sonnet, sanitizar imagem via Nano Banana edit, timer de geração, upload/paste/drop de imagem inicial.
- **Smoke test fixes (2026-05-05):** spinner imediato ao re-editar; modal de publish pré-preenche projeto+nome do asset existente e mostra info ao vivo "vai sobrescrever" vs "vai criar novo" — mudou nome/projeto, backend duplica vídeo + cria asset novo (visão 1:1 preservada via novo endpoint `POST /api/videos/:id/publish-as-new`); listeners do modal de detalhe do asset capturam `video_id` antes do `closeModal` (que zerava `currentAsset` e fazia o handler explodir silenciosamente).

**Ambiente local funcionando** com bypass de auth + túnel IAP pro Postgres da VM. Ver "ambiente local" abaixo.

### Bug aberto

- **"Usar como imagem inicial" no modal de paste/drop:** botão clica mas request `/api/generate/ref-upload` não dispara. Adicionei console.log de debug — precisa o user reproduzir e me trazer o log.

### Pendências de futuro

- Cobrir edição/recorte de uploads/gerados (não só url) — `extract` só funciona com source_url hoje.
- "Adapt for content policy" automático antes do gerar (se quiser virar opt-in).
- Adicionar crédito Anthropic na chave pra o "melhorar" funcionar (chave atual está sem crédito em local e em prod — UI mostra mensagem clara quando falha).

## Ambiente local (dev no Windows)

Setup já feito, persiste sem reconfiguração:

- **Server:** `node server.js` na pasta do projeto. Porta 5050 (5031 ocupada por outra coisa). URL: http://localhost:5050.
- **Auth:** bypass via `DEV_USER_SUB` + `DEV_USER_EMAIL` no `.env`. `requireUser` injeta esse user, `auth.js` do front detecta `localhost` e pula Logto.
- **Postgres:** túnel IAP do Windows → container `roto-pgproxy` (socat) na VM → Postgres real. Comando: `gcloud compute start-iap-tunnel adorable-claude 5433 --zone=us-central1-a --local-host-port=localhost:5433`. `scripts/dev.cmd` automatiza.
- **GCS:** mesma chave que produção, copiada no `.env` local. Sobe arquivos pro mesmo bucket.
- **yt-dlp + ffmpeg:** binários em `~/.local/bin/` (yt-dlp.exe e ffmpeg-portable/). Path via env `YTDLP_BIN` e `FFMPEG_DIR` no `.env`.
- **fal.ai key:** `FAL_KEY` no `.env` (toolbelt pessoal). Mesma chave que VM.
- **Anthropic:** chave do toolbelt **sem crédito** — testes locais do "melhorar prompt" falham com 400, mensagem clara aparece no UI.

**Persistência VM:**
- `roto-pgproxy` rodando com `--restart unless-stopped` — sobrevive reboot.
- Firewall rule `allow-iap-pgproxy` (5433 do range IAP).

## O que está em produção e funcionando

### Plataforma e infra
- Container `roto-master` em `:5031`, Caddy serve `roto.did.lu` com HTTPS automático.
- Postgres compartilhado da plataforma, database `roto_master`. Migrations 001–009 aplicadas (as 005–009 criaram tabelas de v2 que ainda não são consumidas).
- Logto App ID `36iz4iomybe4r1n67a7jc` (Google OAuth), `auth.did.lu`. Multi-user via `req.user.sub`.
- GCS: bucket `didlu-imagestore`, URL pública via `https://st.did.lu/...`. Auth via `GCS_SERVICE_ACCOUNT` injetada pela plataforma.

### Galeria
- Home (`#/`): lista projetos onde o user é membro.
- Modal "novo projeto": cria + insere creator como owner em transação.
- Detalhe do projeto (`#/p/:id`): lista assets, filtros (todos/pendentes/feitos), chamada redigida quando vazio (sem "+ novo asset", anti-padrão 6.5).

### Ateliê
- Subseção Vídeos (`#/atelie`): grid de vídeos do user, selos (origem + publicado/rascunho), criar vídeo (fluxo A), apagar via confirm modal.
- Outras 3 subseções (Personagens, Enquadramentos, Câmeras) com selo "em breve" na sidebar — placeholders deferidos pra v2.

### Editor (`#/v/:id`)
- Editor de rotoscopia preservado: dois modos, dual-thumb in/out, transport único WYSIWYG, presets, sliders de PARAMS, export `.aseprite` local.
- Carrega vídeo do GCS se já upado; senão espera file picker e sobe em background.
- Autosave debounced (1s) + flush no beforeunload; `edit_state` restaurado ao reabrir.
- Modal "publicar como asset": escolhe projeto, aviso de sobrescrita ao republicar, transição animada de volta pra Galeria → Detalhe do projeto.

### Chrome global
- Alternador binário Galeria/Ateliê no canto direito do header.
- Header muda de cor entre os dois espaços (ink frio / cobre quente).
- Transição animada (~500ms) ao trocar de espaço, com label do destino.
- Breadcrumb persistente refletindo o caminho.

## O que falta pra fechar a v1

Apenas o item 5. Itens 1–4 implementados no commit `10d59fc` e em produção em `https://roto.did.lu`.

5. **Smoke test sistemático com você usando.** Você navega no app, lista tudo que parecer estranho (visual, fluxo confuso, console error), eu corrijo em batch. Aí marca v1 fechada formalmente.

### Resumo do que foi entregue nos itens 1–4

- **Item 1 — Detalhe do asset (modal 6.7).** `DELETE /api/assets/:id` (despublicar via `ON DELETE SET NULL`). Listagem de assets retorna `owner_email` via subquery em `project_members`. Modal `asset-detail` em `index.html`; lógica em `public/js/asset_modal.js`. Card no `gal_project.js` virou `<button>` com preview tipográfico (primeira letra do nome) e atalhos `↓ ↗` no hover. Inline-edit do nome no modal (Enter confirma, Esc descarta). Chip de status alterna pendente↔feito direto.
- **Item 2 — Vínculo asset→vídeo do lado do vídeo.** `GET /api/videos` com `LEFT JOIN` em `assets`+`projects` retornando `published_project_id` e `published_project_name`. Card de vídeo no Ateliê mostra "publicado em [Projeto]" como botão clicável que leva pro detalhe do projeto.
- **Item 3 — Duplicar vídeo.** `POST /api/videos/:id/duplicate` em transação: copia row sem `published_asset_id`, copia arquivo no GCS server-side via `lib/gcs.copyObject` (não baixa o blob). UI: botão `⎘` no hover do card de vídeo no Ateliê + botão "duplicar vídeo" no modal de detalhe do asset (caminho "publicar em outro projeto").
- **Item 4 — Convite de membros pelo UI.** `POST /api/projects/:id/members` (só owner; resolve sub via lookup em `project_members` ou cai em `pending:<email>` quando desconhecido). `DELETE /api/projects/:id/members/:sub` (só owner; bloqueia remover último owner). `middleware/auth.js` resolve linhas `pending:<email>` pro sub real automaticamente no primeiro login do convidado, com guarda contra duplicata. Seção "Membros" no detalhe do projeto com avatar+email+role+selo "aguarda 1º login" pros pending; input "adicionar por email" só visível pra owner.

## O que NÃO está na v1 (fica pra v2)

- Fluxo D (módulo personagem completo: aparências, enquadramentos, movimentos, viewport 3D, hierarquia de prompt).
- Jobs assíncronos + worker + tela "Gerações" no Ateliê + indicador no header.
- Catálogo de modelos consumido pela UI (tabela `models` já tem seed mas frontend não lê).
- Fluxos B (URL) e C (geração genérica).
- Share link público via `share_id`.
- Histórico de versões publicadas do mesmo asset (republish sobrescreve).
- Permissionamento granular dentro do projeto.
- Outros formatos de saída além de `.aseprite`.

## Próximos passos — plano pra fechar a v1

A ordem aqui é intencional. **Itens 1 e 2 são pareados** (um do lado do asset, outro do lado do vídeo) e fecham a regra 4 da seção 6.6 (vínculo asset↔vídeo visível). Item 3 é a operação de primeira classe que a visão (decisão 5) deixou faltando. Item 4 transforma "projeto compartilhado" de promessa do schema em coisa real. Item 5 é amarração final.

### 1. Detalhe do asset (modal)
Conforme `docs/visao-da-ferramenta.md` seção 6.7. Inclui o card também — hoje é puro losango sem ação.

Quebra em sub-passos:
- **Backend:** rota `DELETE /api/assets/:id` ("despublicar"; vídeo volta a ser rascunho, asset some). Já existe `PATCH /api/assets/:id` pra status — confirmar se aceita transição pendente↔feito sem regalia.
- **Frontend:**
  - Card de asset no `gal_project.js` ganha: click abre modal, hover revela atalhos `↓` (download direto) e `↗` (abrir editor direto), preview tipográfico (substituir o `◇`), selo de origem do vídeo.
  - Novo arquivo `asset_modal.js`: monta e gerencia o modal de detalhe. Lê o asset + busca o vídeo associado pra mostrar nome no vínculo "fonte".
  - Integração com router: opcional adicionar `#/p/:id/a/:asset_id` pra deep-link, mas pode ficar pra depois.

### 2. Vínculo asset↔vídeo visível do lado do vídeo
- Card de vídeo no Ateliê hoje mostra "publicado" sem dizer onde. Trocar pra "publicado em [Projeto X]" com nome do projeto, **clicável** — leva pro detalhe do projeto.
- Backend: `GET /api/videos` já retorna `published_asset_id`; expandir pra incluir `project_id` e `project_name` quando publicado (subquery via JOIN).
- Frontend: `atelie_videos.js` consome o campo novo e renderiza.

### 3. Duplicar vídeo na workbench
Operação de primeira classe (decisão 5 da seção 9 da visão).

- **Backend:** `POST /api/videos/:id/duplicate`. Cria row `videos` nova com mesmos `name` (com sufixo "(cópia)" ou similar), `origin`, `edit_state`, mas **sem** `published_asset_id` e **sem** `source_*_id` (duplicata é independente — visão fala explicitamente disso). Copia o arquivo no GCS pra path novo (`roto-master/videos/<novo-id>/source.<ext>`).
- **Frontend:** ação "duplicar" no card de vídeo (Ateliê) e no modal de detalhe do asset (item 1) — fluxo "publicar em outro projeto" começa por aqui.

### 4. Convite de membros pelo UI
Hoje a tabela `project_members` existe e é honrada nas queries, mas só dá pra adicionar membros via INSERT manual no banco. Sem UI, "projeto compartilhado" é só promessa.

- **Backend:**
  - `POST /api/projects/:id/members` body `{ email }`. Faz lookup no Logto (existe API `/api/users?search=<email>` em `auth.did.lu` — confirmar antes de implementar; se não existir, cair em INSERT cego e a primeira vez que o convidado logar o `member_sub` é resolvido). Retorna o membro adicionado.
  - `DELETE /api/projects/:id/members/:sub`. Só owner pode. Não deixa remover o último owner.
- **Frontend:** seção "Membros" no detalhe do projeto (`gal_project.js`), com lista atual e campo "adicionar por email" (só visível pra owner).

### 5. Smoke test sistemático
Após 1–4, você navega no app, lista tudo que parecer estranho (visual, fluxo confuso, console error), eu corrijo em batch. Atualizar PROGRESS pra marcar v1 fechada.

## v2 — depois da v1 fechar

Aplicar migrations 005–009 já está feito; falta o código que consome.

1. **Worker + tela de Gerações** — `worker.js` em paralelo ao `server.js`, consome `jobs WHERE status='queued'` com `FOR UPDATE SKIP LOCKED`. Subseção "Gerações" no Ateliê (5ª da sidebar) com lista cronológica + botão retry pra falhas. Indicador no header global com contador de jobs ativos.
2. **Fluxo D (módulo personagem)** — viewport 3D reaproveitando `prototype-v1-personagem/`, etapas aparência → enquadramento → movimento. Hierarquia de prompt embutida. Catálogo `models` consumido pela UI.
3. **Fluxos B/C** — vídeo de URL e geração genérica.
4. **Share link público** — rota `GET /api/share/:share_id` (sem auth) retorna metadata + URL do `.aseprite`.

## Estrutura do projeto

```
server.js                  Express + /api/health + monta /api/{config,videos,projects,assets}
package.json               express, pg, @google-cloud/storage, multer
Dockerfile                 node:20-alpine, EXPOSE 5031
did.json                   manifest da plataforma (logto+db+domain)

migrations/
  001_videos.sql                       videos (id, owner_sub, name, gcs_*, edit_state, share_id)
  002_videos_workbench_columns.sql     ALTER videos: origin + published_asset_id + source_*
  003_projects.sql                     projects + project_members (compartilhados)
  004_assets.sql                       assets + UNIQUE(video_id) + FK videos.published_asset_id
  005_personagens.sql                  personagens + aparencias + enquadramentos + movimentos (v2)
  006_enquadramentos_avulsos.sql       enquadramentos reusáveis sem personagem (v2)
  007_cameras_salvas.sql               presets de câmera do usuário (v2)
  008_jobs.sql                         jobs assíncronos + índice pro worker (v2)
  009_models.sql                       catálogo de modelos + seed (v2)

lib/
  gcs.js                   helper de upload pro GCS (bucket didlu-imagestore)

middleware/
  auth.js                  requireUser — valida token Logto via /oidc/me
  membership.js            isMember, isOwner — projetos compartilhados

routes/
  config.js                GET /api/config — identidade do user
  videos.js                CRUD + POST :id/upload + POST :id/publish (transação)
  projects.js              CRUD com membership; criação insere creator como owner
  assets.js                lista escopada, PATCH (rename/status), POST :id/publish (republish)

public/
  index.html               chrome global + screens + modais + canvas editor
  styles.css               sistema visual Atelier 2087 (paleta cobre/ink + Fraunces)
  logto-auth.js            wrapper do SDK Logto
  js/
    main.js                bootstrap: auth → router → screens
    auth.js                initAuth, signIn, signOut, authedFetch
    router.js              hash routing (#/, #/p/:id, #/atelie, #/v/:id)
    chrome.js              setSpace, setBreadcrumb, transição animada
    modals.js              sistema de modais + confirmModal + showToast
    gal_home.js            lista projetos + criar projeto
    gal_project.js         detalhe do projeto + lista de assets + filtros
    atelie_videos.js       lista vídeos + criar vídeo (fluxo A; B/C/D em breve)
    editor.js              wrapper editor: carrega gcs_url, upload em background, publicar
    autosave.js            debounce 1s + restore de edit_state
    file_loader.js         file picker + drag-drop + loadFromUrl (carrega do GCS)
    projects_api.js        cliente da API /api/projects
    assets_api.js          cliente da API /api/assets
    videos_api.js          cliente: list/create/get/patch/delete + upload + publish
    state.js               PARAMS, PRESETS, SLIDERS, STATE
    shaders.js             VS_SRC, FS_SRC
    gl.js                  WebGL boot + render + pixel IO
    capture.js             seek/await + resample + overlay + buildTimeline
    aseprite.js            ByteWriter + buildAseprite
    playback.js            source/rotoscope loops + setMode
    ui.js                  DOM refs + setProgress + handlers + export
```

## Decisões arquiteturais já estabelecidas (não revisitar sem motivo)

- **Sem build step.** Vanilla ES modules + CDN. Frontend serve direto via `express.static('public')`.
- **Modais custom** pra criar/confirmar (regra UI global: nunca `prompt()`/`confirm()`/`alert()` do browser).
- **Hash routing** em vez de history API — simples, não exige fallback no servidor.
- **Multi-user via `owner_sub`** do Logto, não via `ADMIN_TOKEN`. Whitelist removida deliberadamente.
- **Live bindings** preservados nos módulos WebGL (`prevTex`/`fbTex`/`plainProg` como `let` exportados, consumers via `import * as glmod`).
- **DI no playback** (não circular): `playback.js` recebe deps de UI via `bindUI()`.
- **Captura determinística** com `Promise.race([rVFC, setTimeout(80ms)])` — bug "frames idênticos" resolvido em 2026-04-30.
- **Y-flip:** `<video>` em `texImage2D` precisa de `UNPACK_FLIP_Y_WEBGL=true`. Buffer rotoscope chega bottom-up; export aplica `flipYRGBA` pra Aseprite (top-down).

## Histórico

### Fase 0–2.5 (no repo `random-experiments`, até 2026-04-30)
- PoC inicial → modularização (1463 linhas de monolito → 8 módulos ES) → 3 bugs fixed (modo source não iniciava, Y-flip rotoscope, dual-range trava).
- Detalhe completo no commit `a2cd695` do `random-experiments`.

### Fase 3 (este repo, 2026-04-30)
- File picker / drag-drop substituindo `<video src="video.mp4">` fixo.
- Embrulhamento Express + Docker + did.json.
- Deploy em `roto.did.lu` (com bug de domain customizado nos scripts da plataforma — corrigido na VM).
- Auth Logto Google + tabela `videos` + multi-user.
- Lista de vídeos como home + criação via modal + roteamento hash.

### Fase 4 — discussão de visão (2026-05-02 a 2026-05-03)

Sem código. Discussão profunda de produto que produziu dois documentos centrais:

- `docs/modulo-personagem.md` — primeira proposta: pipeline opinionada de 4 etapas (aparência → enquadramento → movimento → rotoscopia), com viewport 3D para enquadramento e árvore de exploração.
- Protótipo navegável v1 em `prototype/` (frontend-design skill + Three.js + Mixamo FBX). Validou visualmente o módulo personagem mas **revelou problema conceitual:** acoplamento forçado personagem ↔ enquadramento ↔ movimento, e foco excessivo no módulo personagem como se fosse o produto inteiro.
- `docs/visao-da-ferramenta.md` — síntese final que recoloca o módulo personagem como **um caminho dentro da ferramenta maior** (esteira de produção de assets de rotoscopia). Define entidades (Projeto, Asset, Workbench), separação clara entre asset (entregável) e recurso da workbench (matéria-prima), princípio de baixo acoplamento (personagens/enquadramentos/câmeras como recursos independentes reusáveis), e ato deliberado de "publicar como asset".

**Próximo passo é refazer o protótipo** refletindo a visão mestra antes de qualquer código de produção.

## Deploy

### Fluxo (rápido)

Local (Windows) → push pra `main` → na VM, rodar `deploy.sh roto-master`:

```powershell
# da máquina local, depois do git push:
gcloud compute ssh adorable-claude --zone=us-central1-a --project=didlu-main `
  --command="bash /home/manu/platform/scripts/deploy.sh roto-master"
```

O `deploy.sh` patchado em 2026-05-05 (`adorable-devops` commit `c539cd6`) faz:
1. **STEP 0** — auto-detecta se app é novo (sem race condition).
2. **STEP 0.5** — `git fetch + reset --hard` em `/home/manu/platform/roto-master/` (que é repo git apontando pra `mr-velvet/roto-master`). **Esse passo é o que sincroniza o código novo pra prod.**
3. **STEP 1** — valida secrets em `did.json` contra `/home/manu/platform/.env`.
4. **STEP 2** — sincroniza env vars no `docker-compose.yml` via `compose-update.py`.
5. **STEP 3** — aplica migrations pendentes (tabela `_migrations` no banco).
6. **STEP 4** — `docker compose build`.
7. **STEP 5** — `docker compose up -d` + healthcheck.

### Env vars em prod (declaradas em `did.json`)

| Var | Origem | Notas |
|---|---|---|
| `GCS_SERVICE_ACCOUNT` | `.env` da plataforma | JSON multilinha, mesma da plataforma |
| `FAL_KEY` | `.env` da plataforma | Adicionada em 2026-05-05 (toolbelt pessoal `~/dev/universal-toolbelt/.api-keys.json` → fal_ai). Mesma do dev local |
| `ANTHROPIC_API_KEY` | `.env` da plataforma | Já existia. Sem crédito → "melhorar prompt" falha com 400 e mensagem clara no UI |

Pra adicionar var nova: editar `did.json` (`{ "source": "platform", "required": true }`) + garantir que está em `/home/manu/platform/.env` na VM antes do deploy. `deploy.sh` falha cedo se var marcada `required` está faltando.

### Bootstrap de uma app nova nesse fluxo (one-shot)

Pra um app começar a usar o `git pull` automático do STEP 0.5, transformar a pasta `/home/manu/platform/<app>/` em repo git apontando pro GitHub:

```bash
cd /home/manu/platform/<app>
git init
git remote add origin https://github.com/mr-velvet/<app>.git
git fetch origin
git checkout -b main
git reset --hard origin/main
```

Depois disso todo `deploy.sh <app>` puxa o HEAD remoto antes de buildar. Já feito pro `roto-master`.

### Patches no `adorable-devops`

- **Sincronizados** (commits no repo + aplicados na VM):
  - `c539cd6` (2026-05-05): `deploy.sh` STEP 0 sem race; STEP 0.5 com git pull.
- **Aplicados só na VM** (não sincronizados):
  - `new-app.sh`: aceita flag `--domain`.
  - `deploy.sh`: lê `.domain` do `did.json` e propaga via `--domain` (versão da VM tem isso, repo ainda não).
  - `compose-update.py`: regex tolerante a linhas em branco no bloco `environment:`.

### Bugs conhecidos nos scripts da VM (não corrigidos)

- `kill-app.sh` não suporta `domain` customizado (deixa Caddyfile/DNS órfãos no teardown).
- `new-app.sh` etapa Logto: `INSERT` com `2>/dev/null` engole erro silencioso. Recuperação manual via `/tmp/insert-logto.sh`.

## Referências

- **Visão da ferramenta (referência mestra, com patch v3 antidelírio):** `docs/visao-da-ferramenta.md` — ler **inteiro**, especialmente seção 6.
- **Arquitetura técnica:** `docs/arquitetura-tecnica.md` — espelho técnico da visão. Régua: time interno pequeno, sem cerimônia desnecessária.
- **Módulo personagem (especialização):** `docs/modulo-personagem.md`
- **Protótipo navegável v1** (módulo personagem isolado — preservado como referência histórica): `prototype-v1-personagem/`
- **Protótipo navegável v2** (refeito em 2026-05-04, contexto limpo): `prototype/` — foco na metáfora Galeria/Ateliê, com diferenciação visual deliberada entre os dois espaços (paleta, densidade, header) e transição animada (~500ms) que anuncia o destino. Tudo em vanilla JS + localStorage, sem build.
- Projeto irmão (CLI de geração de vídeo, será absorvido como Fluxo D na workbench): `~/ved/motion-ref-gen/`
- Asset humanoide Mixamo + experimento Three.js base do viewport 3D: `~/ved/random-experiments/skeleton-animation/`
- Spec do `.aseprite`: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
- Deploy guide: `~/dev/claude-preferences/DEPLOY-GUIDE.md`
- Origem da PoC: `~/ved/random-experiments/cga-video-fx/web-aseprite-poc/` (commit `a2cd695`)
- Plano de modularização (histórico): `~/.claude/plans/ent-o-a-gente-tem-tidy-sundae.md`
