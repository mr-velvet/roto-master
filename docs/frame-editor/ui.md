# Frames Editor — UI

Última atualização: 2026-05-07 (criação)

Layout conceitual e fluxos de uso do Frames Editor. Escopo MVP. Decisões finas de pixel, paleta, animação e responsividade ficam em rodada própria de design visual.

Pré-requisitos: `visao.md`, `modelo-de-dados.md`, `ia.md`, `api.md`.

---

## 1. Princípio

A UI do Frames Editor é construída em torno de uma única tela de trabalho — a **tela do editor de tirinha**. Tudo gira em torno de uma matriz de células e um canvas. Não há painéis flutuantes, modos diferentes, contextos competindo: é editor focado.

Antes do editor, há uma tela de entrada (lista de tirinhas). Depois do editor, sai-se via download, publicação, ou voltando à lista.

A área tem **identidade visual própria** (conforme `visao.md` §9), distinta de Assets e Frames Creator — densidade visual maior, layout mais denso, ritmo mais íntimo com o pixel. Decisão concreta de paleta, tipografia e densidade fica fora deste doc.

## 2. Mapa de telas

```
[Header global da plataforma]
  └─ alternador de áreas: Assets | Frames Creator | Frames Editor

Frames Editor:
  ├─ Tela 1 — Lista de tirinhas
  │     └─ entrada pra Tela 2 (abrir tirinha) ou criação (modal)
  │
  └─ Tela 2 — Editor da tirinha
        └─ saída: voltar pra Tela 1, download, publicar
```

Não há outras telas no MVP. Configurações, gerenciamento de assets, perfil — nada disso é Frames Editor.

## 3. Tela 1 — Lista de tirinhas

### 3.1 O que mostra

Grid de cards. Cada card representa uma tirinha existente no banco do Frames Editor (sem filtros, sem ownership — todo mundo com token vê tudo, conforme `visao.md` §7).

Cada card mostra:

- Thumb da tirinha (uma célula, regra de escolha em `api.md` §3 — "primeiro quadro da última camada visível" ou similar).
- Nome da tirinha.
- Data de última edição (campo `updated_at`).

Ações no card:

- **Abrir** — ação primária, click no card. Leva pra Tela 2.
- **Apagar** — ação destrutiva, com confirmação custom (não `confirm()` nativo).
- **Renomear** — edição inline ou via menu contextual.

### 3.2 Criação de tirinha nova

Botão "Nova tirinha" abre um modal (custom, não `prompt()` nativo) com as três origens possíveis (`visao.md` §4):

1. **Vazia** — escolhe largura/altura, primeira camada, primeiro quadro. Cria e abre.
2. **Subir `.aseprite`** — input de arquivo. Após escolha, parsing local + upload de células (conforme `aseprite-io.md` §2 e `api.md` §3 variante 2). Quando termina, abre.
3. **Importar de asset** — abre seletor de assets (lista de assets da plataforma, com ação rápida). User escolhe asset; se houver mais de um `.aseprite` candidato (`original-da-quebra` e `final`), modal pergunta qual. Caminho final igual ao 2.

Durante criação que envolve parsing+upload (cases 2 e 3), UI mostra progresso ("subindo célula X de Y"). Modal não fecha até concluir; falha mostra mensagem e mantém o user na escolha.

### 3.3 Atalho a partir da área Assets

Os assets têm botão "**Editar como tirinha**" no próprio card (na área Assets). Clicar leva o user direto pra Tela 2 do Frames Editor com a tirinha já criada e aberta. É equivalente ao caminho 3 acima, mas iniciado da outra área.

## 4. Tela 2 — Editor da tirinha

### 4.1 Estrutura macro

Três regiões:

- **Topo** — barra estreita com nome da tirinha (editável inline), botões de saída/exportação ("Voltar", "Download", "Publicar como asset"), botão de "Nova tirinha".
- **Centro / acima da matriz** — **canvas principal**, mostrando o quadro selecionado com todas as camadas visíveis compostas. É a visualização. Não é editável a pixel no MVP (conforme `visao.md` §6).
- **Base** — **matriz camadas × quadros**, ocupa boa parte da altura. É a área de trabalho principal.

Sem painéis laterais flutuantes. Sem janelas modais persistentes. Tudo direto.

### 4.2 Matriz camadas × quadros

A matriz é o coração da tela. Estrutura:

- **Linhas = camadas** (`fe_camada`), ordenadas por `ordem` (z-index visual).
- **Colunas = quadros** (`fe_quadro`), ordenadas por `indice`.
- **Célula visual = `fe_celula`** correspondente à interseção. Mostra:
  - Thumb do PNG (se `png_url`).
  - Indicador de vazio (transparência xadrez ou similar) se `png_url = NULL`.
  - Overlay de "processando" se `estado = processando` (animação leve, não bloqueante).

Headers da matriz:

- **Header de coluna** — número/índice do quadro. Clicável (seleciona quadro inteiro = coluna).
- **Header de linha** — nome da camada + ícone de visibilidade (toggle). Clicável (seleciona camada inteira = linha). Nome editável inline.

### 4.3 Seleção

A seleção é estado local da UI (não persiste no banco). Modos:

- **Célula única** — clicar numa célula.
- **Coluna inteira (= um quadro)** — clicar no header da coluna.
- **Linha inteira (= uma camada)** — clicar no header da linha.
- **Múltiplas** — `shift+click` adiciona, `ctrl/cmd+click` toggle. Drag de seleção retangular também aceitável.

A célula clicada (ou a primeira da seleção múltipla) define o **quadro ativo no canvas** acima.

### 4.4 Canvas (preview do quadro)

Mostra o **quadro ativo** com todas as camadas visíveis (`visivel = true`) compostas conforme ordem (z-index). É read-only no MVP — não há ferramentas de pintura.

Quando o quadro ativo muda (via seleção na matriz, ou setas do teclado), o canvas re-renderiza.

Ao lado do canvas (ou abaixo), controles leves: zoom, alternar fundo (transparente/sólido pra inspecionar), ir-pro-quadro-anterior / próximo.

### 4.5 Ações primárias

Layout enxuto Aseprite-like. **Um único botão "prompt"** visível e discreto perto do canvas (descobertabilidade), que muda de comportamento conforme seleção: sem seleção → "prompt pra todos os quadros"; com seleção → "prompt em N selecionadas". Tudo o resto vive no **menu de contexto custom (botão direito)** sobre a matriz:

- **Header de linha (camada):** + camada acima/abaixo · renomear (F2) · alternar visibilidade · prompt na camada · prompt nos selecionados (se aplicável) · deletar.
- **Header de coluna (quadro):** + quadro à esquerda/direita · prompt no quadro · prompt nos selecionados (se aplicável) · deletar.
- **Célula:** prompt nesta célula · prompt nos selecionados (se aplicável) · limpar (se tem PNG).
- **Área vazia da matriz (canto sup. esquerdo):** + camada · + quadro · prompt pra todos.

Botão direito numa célula/linha não-selecionada seleciona-a antes de abrir o menu (comportamento Aseprite). `F2` na tela renomeia a camada ativa. Disparar prompt envia `POST /api/fe/prompts` (`api.md` §7).

Ao disparar prompt, as células alvo entram em estado `processando` imediatamente (UI reflete antes mesmo do servidor responder, ou logo após — depende da ordem de chegada). Conforme cada uma termina, o thumb na célula atualiza via gancho de live update (`api.md` §8).

### 4.6 Comportamento durante processamento

User não fica bloqueado. Durante prompt em curso:

- Pode navegar entre quadros (canvas atualiza pro estado mais recente do quadro selecionado).
- Pode disparar **outro** prompt em outras células (que não estejam processando).
- Pode editar metadados (renomear tirinha, renomear camada, reordenar — embora reordenar enquanto há prompt em curso seja decisão de produto: aceitável no MVP, talvez restringir depois).
- Pode fechar a aba. Quando voltar, encontra o resultado aplicado (ou processamento ainda em curso).

Tentativa de disparar prompt sobre célula que já está `processando` é rejeitada silenciosamente (botão de prompt fica desabilitado pra essas células, ou o request volta erro tratado sem incomodar o user).

### 4.7 Saída

Três ações no topo:

- **Download** — gera `.aseprite` no front (`aseprite-io.md` §3), sobe via `POST /api/fe/upload-aseprite` (`api.md` §9), front dispara download do blob/URL retornado.
- **Publicar como novo asset** — gera `.aseprite`, dispara `POST /api/fe/tirinhas/:id/publicar-asset`. UI confirma "asset criado" com link pra abrir o asset na área Assets. **Tirinha continua viva no Frames Editor** — sem vínculo com o asset criado.
- **Voltar** — leva à Tela 1. Estado da tirinha está sempre persistido (sem "salvar" explícito); voltar não perde nada.

## 5. Anti-padrões a evitar (específicos desta área)

A `visao-da-ferramenta.md` já lista anti-padrões globais. Os específicos do Frames Editor:

1. **Pintura inline no canvas no MVP.** Tem que estar fora — quem precisa, baixa o `.aseprite`. Trazer pintura agora desfoca o produto.
2. **Painel de "histórico" / "undo profundo".** Estado é `idle`/`processando`. Versões não existem no MVP.
3. **Aba lateral de "ferramentas IA"** com presets nomeados ("estilizar", "limpar", "colorir"). É **prompt aberto**, ponto. Categorizar quebra o princípio.
4. **Salvar explícito.** Tudo é live, autosave implícito (a cada operação, banco atualiza). Botão "Salvar" cria ilusão de estado local que não existe.
5. **Filtros "minhas tirinhas" / "do user X"**. Não há ownership.
6. **Modal de "novo arquivo" no estilo desktop** (com File → Open, Save As). Frames Editor é online — o modelo mental é diferente, e a UI precisa refletir isso.
7. **Indicador de progresso bloqueante** durante prompt. User segue trabalhando; processamento é pano de fundo.
8. **Diálogos nativos** (`alert`, `confirm`, `prompt`, `<select>`, etc.) — proibido em toda a plataforma. Custom sempre.
9. **Menu de contexto nativo do browser** dentro da área do produto. `event.preventDefault()` no `contextmenu` é obrigatório fora de campos de texto. Quem implementa botão direito faz menu custom.

## 6. Fluxos de uso típicos

Pra ancorar o desenho:

**Fluxo A — abrir asset, dar prompt em todos os quadros, publicar de volta:**
1. Na área Assets, clica "Editar como tirinha" num card de asset → vai pro Frames Editor já com a tirinha aberta.
2. No editor: clica "Prompt pra todos", digita o prompt, confirma. Vê células ficarem em `processando`.
3. Aguarda (ou navega entre quadros enquanto processa). Conforme cada célula termina, thumb atualiza.
4. Quando satisfeito: clica "Publicar como novo asset". Asset novo aparece na área Assets. Tirinha continua no Frames Editor.

**Fluxo B — refinar quadro específico:**
1. Abre tirinha existente da Tela 1.
2. Seleciona uma célula específica (clique na matriz).
3. Canvas mostra o quadro. User decide refinar.
4. Clica "Prompt pros selecionados" com a célula como alvo. Dispara prompt curto.
5. Resultado aparece em segundos. Se gostou, segue. Se não gostou, dispara de novo (descarta o anterior).

**Fluxo C — subir arquivo do desktop, baixar resultado:**
1. Tela 1, "Nova tirinha", "Subir `.aseprite`". Escolhe arquivo. Parsing + upload.
2. Tirinha aberta no editor. Prompt em quadros selecionados, ou em todos.
3. Quando termina, "Download". Pega o `.aseprite` resultante. Continua trabalhando no Aseprite desktop.

**Fluxo D — duas pessoas no mesmo material (não simultâneo):**
1. Pessoa A abre tirinha, dispara prompt em todos. Fecha aba.
2. Pessoa B abre a mesma tirinha 10 minutos depois. Vê algumas células ainda `processando`, outras já com resultado novo. Dispara prompt em outras.
3. Trabalho continua sem coordenação explícita.

## 7. O que não está aqui

- Layout exato (posições, dimensões, grid).
- Paleta, tipografia, densidade visual concreta.
- Atalhos de teclado.
- Microinterações (hover, focus ring custom, animações de transição).
- Comportamento responsivo / mobile.
- Acessibilidade (a tratar quando o produto amadurecer).
- Ícones e identidade gráfica.
- Estados de erro detalhados (mensagens específicas, formatos de toast).

Tudo isso é matéria de uma rodada de design visual e de implementação de front, com este documento como contrato conceitual.
