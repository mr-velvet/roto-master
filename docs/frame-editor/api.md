# Frames Editor — API

Última atualização: 2026-05-07 (criação)

Contratos entre o front do Frames Editor e o backend da plataforma. Escopo MVP.

Pré-requisitos: `visao.md`, `modelo-de-dados.md`, `storage.md`, `aseprite-io.md`, `ia.md`.

---

## 1. Princípio

O front faz o que envolve o navegador: parsing/geração de `.aseprite`, render no canvas, upload de PNG individual. O servidor faz o que envolve o banco, o GCS e a IA.

Endpoints são **REST simples**, JSON pra dados, multipart pra upload de imagem. Sem GraphQL, sem RPC. Prefixo `/api/fe/` em tudo (separação clara de outras áreas — Frames Creator e Assets têm seus próprios prefixos).

Auth segue o padrão da plataforma: `APP_TOKEN` único compartilhado em header `Authorization: Bearer <token>` (princípio "nada é do usuário").

## 2. Convenções

- Identificadores são UUIDs em todo lugar.
- Datas em ISO 8601 UTC.
- Erros retornam `{ "error": "<mensagem>" }` com status HTTP apropriado.
- Campos opcionais omitidos no JSON de resposta quando ausentes (não enviam `null` desnecessário).
- URLs de imagem na forma curta `https://st.did.lu/...`.

## 3. Tirinhas

### `GET /api/fe/tirinhas`

Lista tirinhas. Sem filtros no MVP (não há ownership, lista todas).

**Resposta:**
```json
{
  "tirinhas": [
    {
      "id": "uuid",
      "nome": "...",
      "thumb_url": "https://st.did.lu/...",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

`thumb_url` é uma das células renderizadas (escolha do servidor — primeiro quadro da última camada visível, ou regra equivalente). Decisão concreta de qual célula vira thumb fica pra implementação.

### `POST /api/fe/tirinhas`

Cria tirinha. Três variantes pelo campo `origem`:

**Variante 1 — vazia:**
```json
{ "origem": "vazia", "nome": "..." }
```

**Variante 2 — upload manual:**
O cliente faz primeiro o parsing do `.aseprite` no navegador (conforme `aseprite-io.md`), sobe os PNGs das células via §6, e finaliza com este endpoint:
```json
{
  "origem": "upload",
  "nome": "...",
  "origem_meta": { "nome_arquivo": "..." },
  "largura": 64, "altura": 64,
  "camadas": [{ "nome": "...", "ordem": 0, "visivel": true }, ...],
  "quadros": [{ "indice": 0 }, ...],
  "celulas": [
    { "camada_indice": 0, "quadro_indice": 0, "png_url": "https://st.did.lu/..." , "largura": 64, "altura": 64 },
    { "camada_indice": 1, "quadro_indice": 0 },  // célula vazia
    ...
  ]
}
```

`camada_indice` e `quadro_indice` referenciam a posição na lista enviada (zero-based). Servidor cria as entidades em transação, gera os UUIDs, e responde.

**Variante 3 — asset:**
```json
{
  "origem": "asset",
  "nome": "...",
  "origem_meta": { "asset_id": "uuid", "tipo_aseprite": "original_quebra" }
}
```

`tipo_aseprite` é `original_quebra` ou `final`. Servidor resolve a URL do `.aseprite` no asset, devolve ao cliente, e o cliente segue o caminho da variante 2 (parsing no navegador, upload de células, finalização). **Detalhe:** o endpoint de criação por asset pode ser uma chamada que devolve a URL e espera o cliente terminar o ciclo, ou pode ser duas chamadas (`GET /api/fe/asset-aseprite-url?asset_id=...&tipo=...` + `POST /api/fe/tirinhas` na variante 2). Implementação escolhe.

**Resposta (todas as variantes):**
```json
{ "id": "uuid", "tirinha": { ...estado completo... } }
```

### `GET /api/fe/tirinhas/:id`

Estado completo da tirinha pra abrir no editor.

**Resposta:**
```json
{
  "id": "uuid",
  "nome": "...",
  "largura": 64, "altura": 64,
  "origem": "upload", "origem_meta": { ... },
  "created_at": "...", "updated_at": "...",
  "camadas": [{ "id": "uuid", "nome": "...", "ordem": 0, "visivel": true }, ...],
  "quadros": [{ "id": "uuid", "indice": 0 }, ...],
  "celulas": [
    { "id": "uuid", "camada_id": "uuid", "quadro_id": "uuid",
      "png_url": "https://st.did.lu/...", "largura": 64, "altura": 64,
      "estado": "idle", "updated_at": "..." },
    { "id": "uuid", "camada_id": "uuid", "quadro_id": "uuid",
      "png_url": null, "estado": "idle" },
    { "id": "uuid", "camada_id": "uuid", "quadro_id": "uuid",
      "png_url": "https://st.did.lu/...", "estado": "processando" },
    ...
  ]
}
```

`estado` da célula é `idle` ou `processando` (ver `ia.md` §5).

### `PATCH /api/fe/tirinhas/:id`

Edita metadados da tirinha. No MVP só `nome`.

```json
{ "nome": "novo nome" }
```

### `DELETE /api/fe/tirinhas/:id`

Apaga tirinha. Cascade no banco (camadas, quadros, células). PNGs no GCS ficam órfãos sem regra ativa de remoção (ver `storage.md` §6).

## 4. Camadas

### `POST /api/fe/tirinhas/:id/camadas`

Adiciona camada. Servidor calcula `ordem` (último + 1) ou aceita explícito. Cria células vazias (`png_url = NULL`) pra cruzar com todos os quadros existentes.

```json
{ "nome": "draw", "ordem": 2, "visivel": true }
```

### `PATCH /api/fe/camadas/:id`

Edita camada — `nome`, `ordem`, `visivel`. Reordenação fica em transação que ajusta as outras camadas afetadas.

### `DELETE /api/fe/camadas/:id`

Apaga camada. Cascade nas células daquela camada.

## 5. Quadros

### `POST /api/fe/tirinhas/:id/quadros`

Adiciona quadro. Servidor calcula `indice` (último + 1) ou aceita explícito. Cria células vazias pra cruzar com todas as camadas existentes.

```json
{ "indice": 5 }
```

Inserção em índice intermediário reindexa quadros subsequentes em transação.

### `DELETE /api/fe/quadros/:id`

Apaga quadro. Cascade nas células daquele quadro. Reindexa subsequentes.

## 6. Células

Célula é a única entidade que carrega imagem. As operações aqui são as mais densas.

### `POST /api/fe/upload-png`

Upload de PNG pra storage. Independente de célula — recebe o blob, sobe no GCS no path correto, devolve URL.

**Multipart:** `file` (PNG blob), `tirinha_id` (UUID, pra resolver o path), `celula_id` (UUID, opcional — se ausente, usa um path provisório que vira definitivo no `PATCH` da célula).

**Resposta:**
```json
{ "png_url": "https://st.did.lu/frame-editor/tirinhas/<id>/celulas/<id>/<...>.png", "largura": 64, "altura": 64 }
```

### `PATCH /api/fe/celulas/:id`

Atualiza célula com novo PNG (após upload) ou esvazia.

```json
{ "png_url": "https://st.did.lu/...", "largura": 64, "altura": 64 }
```

ou

```json
{ "png_url": null }
```

### Fluxo combinado de upload + atualização

Cliente faz `POST /api/fe/upload-png` → recebe `png_url` → `PATCH /api/fe/celulas/:id` com a URL. Dois passos. Servidor não obriga atomicidade entre os dois — se o cliente desistir entre eles, o PNG fica órfão (aceitável conforme `storage.md`).

## 7. Prompt (IA)

### `POST /api/fe/prompts`

Dispara operação de prompt sobre uma ou mais células.

```json
{
  "tirinha_id": "uuid",
  "prompt": "texto livre escrito pelo user",
  "celulas_ids": ["uuid", "uuid", ...]
}
```

Servidor:
1. Em transação, marca todas as células listadas como `processando`.
2. Devolve resposta imediatamente (sem esperar a IA).
3. Processa em background, conforme `ia.md` §6.

**Resposta:**
```json
{
  "job_id": "uuid",
  "celulas_marcadas": ["uuid", ...]
}
```

`job_id` é identificador da operação (útil pra logs, futuro cancelamento). MVP não usa pra cancelar.

### Atualizações em tempo real

Ver §8.

## 8. Live updates

Conforme `ia.md` §6, o front escuta mudanças no banco sem fazer polling explícito de cada célula. Mecanismo concreto fica pra implementação — opções: SSE em `GET /api/fe/tirinhas/:id/eventos` (stream de eventos), WebSocket dedicado, ou polling leve (cliente pergunta "o que mudou desde T?").

**Contrato conceitual** que o mecanismo precisa entregar:

- Evento por célula que mudou de estado (`processando` → `idle` com nova `png_url`, ou erro).
- Evento por mudança de metadado da tirinha (nome editado por outra pessoa, camada adicionada, etc.).
- Evento por criação/remoção de tirinha (relevante pra tela de lista).

Front consome eventos e re-renderiza só o que mudou.

## 9. Exportação

### `POST /api/fe/tirinhas/:id/exportar/aseprite`

Pede ao servidor pra disponibilizar o `.aseprite` da tirinha pra download.

Conforme `aseprite-io.md`, a geração do `.aseprite` acontece **no front**. Então este endpoint serve pra: (a) o front montar o `.aseprite` localmente e enviar como blob; ou (b) o servidor coordenar e devolver URL de GCS quando pronto.

A implementação concreta escolhe — provavelmente o front gera, sobe via `POST /api/fe/upload-aseprite`, e o servidor responde com URL pra download.

### `POST /api/fe/upload-aseprite`

Upload de `.aseprite` gerado pelo front pra storage.

**Multipart:** `file` (`.aseprite` blob), `tirinha_id` (UUID).

**Resposta:**
```json
{ "aseprite_url": "https://st.did.lu/frame-editor/tirinhas/<id>/aseprite/<...>.aseprite" }
```

Substitui o último `.aseprite` exportado da tirinha (conforme `storage.md` §4.2).

### `POST /api/fe/tirinhas/:id/publicar-asset`

Cria asset novo na área Assets a partir do `.aseprite` desta tirinha.

```json
{
  "aseprite_url": "https://st.did.lu/...",
  "asset_meta": { /* dados específicos exigidos pela área Assets — projeto, nome, etc. */ }
}
```

Servidor:
1. Recebe.
2. Chama a área Assets pra criar o asset com aquele `.aseprite`.
3. **Não estabelece vínculo entre tirinha e asset criado** (princípio do desacoplamento — `visao.md` §3 e §5).

**Resposta:**
```json
{ "asset_id": "uuid" }
```

`asset_id` é informativo (pro front confirmar pro user que foi criado). Tirinha não guarda esse ID.

A interface concreta entre Frames Editor e Assets nesse fluxo é responsabilidade do doc `integracao-com-assets.md` (próximo na ordem).

## 10. O que não está aqui

- **Schemas exatos das tabelas** (já cobertos em `modelo-de-dados.md`).
- **Mecanismo concreto de live update** (SSE/WS/polling) — implementação escolhe.
- **Códigos de erro detalhados** — implementação adota convenção da plataforma.
- **Rate limiting** — não imposto no MVP.
- **Versionamento de API** — não há (`v1`, `v2`). Plataforma é deploy contínuo, front e back evoluem juntos.
- **OpenAPI/Swagger formal** — fora do escopo do doc conceitual.
