# Frames Editor — IA

Última atualização: 2026-05-07 (criação)

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

Padrão MVP: **OpenAI Images** (gpt-image-1 / Images 2.0), pela qualidade. A operação é image-edit (input: PNG da célula + prompt; output: PNG novo).

Provider é **configurável** — se algum caso ficar mais barato ou equivalente em outra ferramenta (ex: Fal.ai), trocar é mudança de configuração no servidor, não de modelo conceitual. O front nunca fala com o provider direto.

Detalhes de chave de API, biblioteca, parâmetros padrão, política de retry e tratamento de erro de provider ficam em rodada de implementação, não neste doc.

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
