# Frames Editor — IA

Última atualização: 2026-05-12 — catálogo de modelos (Nano Banana Pro / Nano Banana) selecionável no modal de prompt; receita `fe-style` no Claude pra botão "melhorar prompt"; **undo de prompts persistido em banco** (`fe_celula_versao`) com atalho Ctrl+Z. Versões anteriores: 2026-05-07 (criação) / 2026-05-08 (Fal.ai nano-banana-pro/edit como provider real, não OpenAI Images).

Mecânica de geração por prompt no Frames Editor. Cobre as duas ações de prompt do MVP ("prompt pra todos os quadros" e "prompt pros quadros selecionados") e como elas operam sobre as células.

Pré-requisitos: `docs/frame-editor/visao.md`, `docs/frame-editor/modelo-de-dados.md`, `docs/frame-editor/storage.md`.

---

## 1. Princípio

A IA do Frames Editor roda **no servidor**, consistente com o resto da plataforma. Front pede uma operação, servidor cuida do provider, do upload do PNG resultante no GCS e da atualização do banco. Front escuta a mudança e reflete na UI.

Toda operação de prompt — independentemente de afetar 1 célula ou 200 — é **assíncrona desde o MVP**. Não há "modo síncrono pra prompt em uma célula só". O caminho é único: front dispara, banco marca células como processando, servidor processa em background, banco atualiza conforme cada célula termina, front reflete via gancho.

Esse caminho único é deliberado: simplifica frontend e backend (uma única mecânica), libera o user (pode continuar editando, fechar a aba, voltar depois — o trabalho continua), e deixa o sistema preparado pra escalar pra lotes maiores sem reescrita.

## 2. As duas ações de prompt

Conforme `visao.md` §6, o MVP do editor tem duas ações:

- **Prompt pra todos os quadros** — global, opera sobre todas as células da tirinha (todas as camadas × todos os quadros).
- **Prompt pra quadros selecionados** — contextual, opera sobre as células correspondentes ao que está selecionado (célula única, coluna inteira, linha inteira, ou múltiplas células).

Em ambos os casos, o operador é o mesmo: **prompt aberto** (texto livre escrito pelo user). A ferramenta não classifica intenção — não há "estilizar", "limpar", "gerar variante". É só `prompt` + `conjunto de células alvo`.

## 3. Modelo conceitual

Uma operação de prompt produz, **por célula alvo**, um PNG novo gerado a partir do PNG existente da célula + texto do prompt. O PNG anterior é descartado (substituição, conforme `modelo-de-dados.md`).

Cada célula é processada **independentemente**. Não há contexto compartilhado entre células — o prompt é re-aplicado a cada uma com sua própria imagem de entrada. Isso simplifica a mecânica e mantém o paralelismo trivial. Coerência entre quadros vizinhos é responsabilidade do user (escolhendo prompts adequados, aplicando seleções específicas) e do próprio modelo de IA, não da arquitetura aqui.

**Célula vazia (`png_url = NULL`)** entra como input "vazio" — o prompt gera a partir do nada. Comportamento depende do provider; o Frames Editor não trata como caso especial.

## 4. Provider

Provider é Fal.ai (mesmo `lib/providers/fal.js` que serve Kling/PixVerse no resto da plataforma — mesma `FAL_KEY`, mesmo wrapper). A camada `lib/fe-prompts.js` expõe um **catálogo de modelos** (constante `FE_PROMPT_MODELS`) com 2 entradas no MVP:

- **`nano-banana-pro`** — `fal-ai/nano-banana-pro/edit` (Gemini 3 Pro Image). Default. Qualidade alta, ~30s por célula.
- **`nano-banana`** — `fal-ai/nano-banana/edit` (Gemini 2.5 Flash Image). Mais rápido e barato, ~10s por célula.

O catálogo é exposto via `GET /api/fe/models`. O frontend popula um dropdown no modal de prompt; a escolha vai no body do `POST /api/fe/prompts` como `model_key`. Modelos não listados caem no default — sem erro.

Trocar provider ou adicionar modelo é trabalhar dentro do `lib/providers/fal.js` (função `modelIdParaImagem`) e estender `FE_PROMPT_MODELS`. Nada na UI/banco/contrato muda.

O front nunca fala com o provider direto.

### Melhorar prompt

O modal de prompt tem um botão "melhorar" que usa **Claude Sonnet 4.6** com a receita `'fe-style'` (`lib/prompt-recipes.js`). A receita é orientada à *estilização de célula 2D*: NÃO redescreve sujeito/pose/composição (a imagem-base já entra como ref pro modelo de imagem), expande apenas dimensão estilística (técnica, paleta, traço, textura, mood). Saída curta (40-100 palavras) pra não inflar custo em lote.

Endpoint compartilhado com o resto da plataforma: `POST /api/generate/enhance-prompt` com `{ prompt, kind: 'fe-style' }`.

## 5. Estado "processando"

Cada `fe_celula` tem um estado de processamento — visível ao banco e à UI. Modelo conceitual:

- **idle** — célula com `png_url` atual e nada em curso. Estado padrão.
- **processando** — operação de IA em curso pra esta célula. UI mostra a célula com indicador visual (overlay, spinner, badge). Não bloqueia interação com o resto da tirinha.
- (Em caso de erro, retorna a `idle` com mensagem; ver §8.)

Implementação concreta da coluna que carrega isso (enum, timestamps, FK pra job, etc.) fica em rodada própria. O conceito é o que importa aqui: **célula sabe que está processando**, e isso é visível ao banco (não só à UI local).

Implicações:

- User fecha a aba no meio do processamento → trabalho continua, banco atualiza, ao voltar o user vê o resultado já aplicado.
- Outra pessoa abre a mesma tirinha → vê as células que estão processando como tal, sem confundir com idle.
- Múltiplas operações enfileiradas sobre a mesma célula são possíveis em tese, mas o MVP rejeita: pedir prompt sobre célula que já está processando devolve erro silencioso (UI não permite, banco rejeita).

## 6. Fluxo de uma operação

1. **Front dispara.** User clica "prompt pra todos" ou "prompt pros selecionados", digita o prompt, confirma. Front envia ao servidor: `prompt`, `lista de IDs de células alvo`.
2. **Servidor recebe e marca.** Numa transação, marca todas as células alvo como **processando** no banco. Devolve resposta rápida ao front (HTTP 200, com lista de células marcadas). Front atualiza UI imediatamente — todas as células alvo aparecem como processando.
3. **Servidor processa em background.** Pra cada célula alvo, em paralelo (com limite de concorrência razoável):
   - Baixa o PNG atual da célula (se houver).
   - Chama o provider com prompt + PNG.
   - Recebe PNG novo.
   - Sobe PNG novo no GCS (path conforme `storage.md`).
   - Atualiza `fe_celula`: `png_url` ← novo, estado ← **idle**.
4. **Front reflete via gancho.** Conforme cada célula termina, o front recebe a atualização e re-renderiza só aquela célula. User vê os quadros ficando prontos um a um.

Mecanismo do gancho (polling, Server-Sent Events, WebSocket) fica em rodada de implementação. Conceitualmente: a UI **reage à mudança no banco**, não trava esperando.

## 7. Cancelamento

MVP não suporta cancelamento de operação em curso. Uma vez disparado, processa até o fim (ou erra). Se virar requisito, é coluna de "cancelado" no estado de processamento + checagem antes de cada chamada ao provider.

## 8. Erro

Quando uma célula falha (provider erra, timeout, PNG corrompido):

- A célula volta a estado **idle**, com `png_url` **inalterado** (mantém o que tinha antes).
- Banco registra que a operação falhou (mensagem, timestamp). UI mostra ao user de forma não-bloqueante (toast, ou ícone de aviso na célula).
- As outras células do mesmo lote continuam — uma falha não aborta o lote.

Política de retry automático fica fora do MVP. User vê a falha, decide se quer tentar de novo manualmente.

## 8.1 Undo de prompts (introduzido em 2026-05-12)

Cada prompt aplicado a uma célula é desfazível em single-step:

- Antes do `UPDATE` que substitui `png_url` em `fe_celula`, a versão anterior (`png_url`, `largura`, `altura`, `prompt` usado, `model_key`) é registrada em `fe_celula_versao` (uma linha por célula × prompt aplicado, ordenadas por `created_at DESC`).
- `POST /api/fe/celulas/:id/undo` pega a versão mais recente dessa célula, copia de volta pra `fe_celula`, e deleta a linha de versão. Sem redo.
- 404 se a célula nunca teve prompt aplicado (sem histórico).
- PNGs antigos no GCS ficam intocados (mesma regra geral de storage — sem varredura automática no MVP).

No frontend, a "sessão de undo" é uma pilha em memória (`historicoPrompts`). Cada disparo bem-sucedido empilha `{ celulasIds }`. Ctrl/Cmd+Z pop o topo e chama `undoCelula` em paralelo pra cada célula. Pilha não persiste entre reloads — o histórico em banco fica disponível pra futuras features ("voltar versão" por célula no menu de contexto), mas isso não está no MVP.

Limites: pilha cap em 50 itens (descarta o mais antigo); Ctrl+Z em INPUT/TEXTAREA não é capturado (textarea do modal de prompt segue usando undo nativo).

## 9. Custo e quotas

MVP não impõe quota. Cada user com token pode disparar prompts livremente. Custo é monitorado pela conta do provider (configurada na plataforma, não exposta ao user). Se virar problema, decisão entra em rodada própria.

## 10. O que não está aqui

- **Endpoints concretos** (paths, payloads, contratos HTTP) → `api.md`.
- **Mecanismo do gancho front** (polling vs SSE vs WebSocket) → decisão de implementação.
- **Schema concreto do estado de processamento** (colunas em `fe_celula`, tabela de jobs) → rodada de implementação.
- **Política de retry, backoff, timeout por chamada** → rodada de implementação.
- **Configuração específica do provider** (parâmetros default, modelo exato, tamanho de saída) → rodada de implementação.
- **Cache de resultado por (input + prompt)** → não existe. Cada chamada é uma chamada nova. Resultado da IA é PNG normal no GCS, sem indexação por hash de prompt.
- **Coerência entre quadros vizinhos** (consistência temporal) → não tratada arquiteturalmente. É responsabilidade do user e do modelo.
