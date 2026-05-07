# Frames Editor — modelo de dados

Última atualização: 2026-05-07 (criação) — 2026-05-08 (ajuste pós-migration: explicita `largura`/`altura` em `fe_tirinha`, adiciona `last_aseprite_url`, formaliza colunas de estado em `fe_celula`).

Detalha as entidades do Frames Editor no banco. Escopo MVP. Decisões de UI, IA, API e storage físico ficam em docs irmãos.

Pré-requisito de leitura: `docs/frame-editor/visao.md`.

---

## 1. Princípio

O Frames Editor tem **entidades próprias no banco**, separadas de qualquer entidade do Frames Creator ou de Assets. Tabelas começam com prefixo `fe_` pra deixar a separação inequívoca.

A imagem em si **nunca** mora no banco. O banco guarda **referência** (URL ou caminho) ao PNG no storage. Detalhes de storage físico ficam em `storage.md` (próximo doc).

## 2. Entidades

Quatro entidades no MVP, todas com tabela própria.

### 2.1 `fe_tirinha`

Uma linha por tirinha viva no Frames Editor.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID, PK | |
| `nome` | text | Editável pelo user. Default na criação: derivado da origem (nome do arquivo no upload, nome do asset no import, "Tirinha sem título" no caso de criar vazia). |
| `largura` | int, NOT NULL | Largura do canvas em pixels. Definida na criação (vazia → user escolhe; upload/asset → vem do `.aseprite`). Não muda depois no MVP. |
| `altura` | int, NOT NULL | Altura do canvas em pixels. Mesma regra. |
| `last_aseprite_url` | text, nullable | URL do último `.aseprite` exportado dessa tirinha (forma curta `st.did.lu/...`). Atualizado a cada exportação. NULL = nunca foi exportada. Suporta o "baixar último" em `storage.md` §4.2. |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Atualizado a cada edição relevante (camada/quadro/célula muda). |
| `origem` | text | Enum textual: `vazia`, `upload`, `asset`. Snapshot da origem na criação. Não muda depois. |
| `origem_meta` | jsonb, nullable | Metadado leve sobre a origem. Em `upload`: nome do arquivo. Em `asset`: id do asset, qual `.aseprite` foi importado (`original_quebra` \| `final`). Cicatriz informativa, sem vínculo vivo. |

**Sem `owner_*`.** Toda tirinha é coletiva, conforme princípio "nada é do usuário".

### 2.2 `fe_camada`

Uma linha por camada de uma tirinha.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID, PK | |
| `tirinha_id` | UUID, FK → `fe_tirinha.id`, ON DELETE CASCADE | |
| `nome` | text | Nome da camada (ex: "ref", "draw", "linha", "cor"). Editável. |
| `ordem` | int | Ordem visual (z-index). Convenção: maior = mais em cima na composição. Reordenação rescreve o campo. |
| `visivel` | boolean | Default true. Controla se entra na composição do canvas. |
| `created_at` | timestamptz | |

UNIQUE constraint sugerida: `(tirinha_id, ordem)` — evita ordens duplicadas. Reordenação atualiza em transação.

### 2.3 `fe_quadro`

Uma linha por quadro de uma tirinha (eixo temporal).

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID, PK | |
| `tirinha_id` | UUID, FK → `fe_tirinha.id`, ON DELETE CASCADE | |
| `indice` | int | Ordem temporal (0, 1, 2, ...). Reindexação ao inserir/remover quadros. |
| `created_at` | timestamptz | |

UNIQUE constraint sugerida: `(tirinha_id, indice)`.

Sem duração por quadro no MVP. Se vier no futuro, é coluna `duracao_ms` aqui.

### 2.4 `fe_celula`

Uma linha por interseção camada × quadro. **É aqui que vive a referência à imagem.**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID, PK | |
| `tirinha_id` | UUID, FK → `fe_tirinha.id`, ON DELETE CASCADE | Redundante com camada/quadro, mas barato e simplifica queries por tirinha. |
| `camada_id` | UUID, FK → `fe_camada.id`, ON DELETE CASCADE | |
| `quadro_id` | UUID, FK → `fe_quadro.id`, ON DELETE CASCADE | |
| `png_url` | text, nullable | URL pública do PNG. NULL = célula vazia (transparente, ainda não preenchida). |
| `largura` | int, nullable | Pixels. NULL quando célula vazia. |
| `altura` | int, nullable | Pixels. NULL quando célula vazia. |
| `estado` | text, NOT NULL DEFAULT `'idle'` | `idle` ou `processando` (CHECK constraint). Suporta `ia.md` §5 — operação de IA visível ao banco, não só à UI local. |
| `estado_erro` | text, nullable | Mensagem do último erro de processamento (`ia.md` §8). NULL quando estado limpo. |
| `estado_atualizado_em` | timestamptz, nullable | Quando o estado mudou. Útil pra detectar processamentos travados em rodada própria de monitoração. |
| `updated_at` | timestamptz | Toca a cada substituição de PNG. |

UNIQUE constraint **obrigatória**: `(camada_id, quadro_id)` — uma célula por interseção.

**Substituição (não acumulação):** quando IA regenera ou user edita, o `png_url` é sobrescrito. PNG antigo é descartado (decisão de MVP). Histórico não é preservado.

**Tamanho da célula:** cada célula carrega seu próprio `largura`/`altura`. No MVP a expectativa é que toda a tirinha use o mesmo tamanho (definido na criação a partir da origem), mas o modelo já permite variação — se vier necessidade no futuro, não muda schema.

## 3. Relacionamento e cardinalidade

```
fe_tirinha (1) ──< (N) fe_camada
fe_tirinha (1) ──< (N) fe_quadro
fe_tirinha (1) ──< (N) fe_celula
fe_camada  (1) ──< (N) fe_celula
fe_quadro  (1) ──< (N) fe_celula
```

Para uma tirinha com C camadas e Q quadros: **C × Q linhas em `fe_celula`**. Tirinha de exemplo (4 camadas, 30 quadros) = 120 linhas. Está bem dentro do confortável.

## 4. Ciclo de vida

**Criação de tirinha:**

- `vazia`: insere `fe_tirinha`, sem camadas, sem quadros, sem células. User cria tudo dentro do editor.
- `upload`: insere `fe_tirinha`, parseia o `.aseprite`, insere C camadas (`fe_camada`), Q quadros (`fe_quadro`), C×Q células (`fe_celula`) com PNGs gerados a partir do parsing já subidos no storage. Mecânica de parsing fica em `aseprite-io.md`.
- `asset`: idem `upload`, mas o `.aseprite` vem de um asset (escolha entre `original_quebra` e `final` quando ambos existem). Origem registrada em `origem_meta`.

**Edição:**

- Adicionar/remover/renomear/reordenar camada → mexe em `fe_camada` (e em `fe_celula` por cascade quando remove).
- Adicionar/remover quadro → mexe em `fe_quadro` (cascata em `fe_celula`). Reindexa `indice`.
- Prompt pra todos / pros selecionados → cada célula afetada gera PNG novo, novo PNG sobe ao storage, `fe_celula.png_url` atualizado, PNG antigo descartado.

**Saída (`.aseprite`):** lê `fe_tirinha` + camadas + quadros + células, gera arquivo. Mecânica fica em `aseprite-io.md`.

**Deleção da tirinha:** `DELETE FROM fe_tirinha WHERE id = ?` cascata pra camadas, quadros, células. Limpeza dos PNGs no storage é trabalho separado (varredura periódica), descrito em `storage.md`.

## 5. O que não está aqui

- **Padrão de URL e ciclo de vida do PNG no storage** → `storage.md`.
- **Como o `.aseprite` é parseado pra C/Q/células** → `aseprite-io.md`.
- **Como o prompt de IA opera sobre as células** → `ia.md`.
- **Endpoints, payloads** → `api.md`.
- **Histórico de versões** — fora do MVP. Modelo atual descarta PNGs antigos. Se entrar, é tabela nova `fe_celula_versao` com FK pra `fe_celula`, sem mexer no schema atual.
- **Edição manual de pixels (lápis, balde, etc.)** — fora do MVP. Quando entrar, encaixa neste modelo: a edição gera PNG novo (igual ao que IA faz), substitui na célula correspondente. Schema não muda.
- **Edição simultânea com locking/CRDT** — fora do MVP. Conflito = last-write-wins implícito (quem salvar por último ganha). Quando entrar, é coluna `versao` ou similar em `fe_celula`/`fe_camada`/`fe_quadro`.
