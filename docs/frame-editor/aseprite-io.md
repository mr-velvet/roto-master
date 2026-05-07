# Frames Editor — `.aseprite` I/O

Última atualização: 2026-05-07 (criação)

Como o Frames Editor lê e escreve arquivos `.aseprite`. Escopo MVP.

Pré-requisitos: `docs/frame-editor/visao.md`, `docs/frame-editor/modelo-de-dados.md`, `docs/frame-editor/storage.md`.

---

## 1. Princípio

`.aseprite` é o **único formato de troca** entre o Frames Editor e o resto do mundo. Importar = transformar `.aseprite` em (tirinha + camadas + quadros + células com PNGs). Exportar = transformar o estado atual da tirinha de volta em `.aseprite`.

Operação acontece **no navegador**, em JS puro, sem dependência de binário externo no servidor. O front parseia e gera `.aseprite` direto. Servidor recebe os artefatos já processados (PNGs pra subir no GCS, dados pra inserir no banco, ou o `.aseprite` finalizado pra entregar como download / publicação).

## 2. Importação

### 2.1 Ponto de entrada

Duas origens carregam um `.aseprite` no Frames Editor:

- Upload manual (arquivo escolhido pelo user via input de arquivo).
- Importação a partir de asset (URL do `.aseprite` que vive no asset — `original-da-quebra` ou `final`, conforme escolha do user).

Em ambos os casos o navegador termina com um `ArrayBuffer` do `.aseprite` na mão. A partir daí, o caminho é o mesmo.

### 2.2 Parsing

O front parseia o `ArrayBuffer` com lib JS. Resultado do parsing é uma estrutura em memória com:

- Largura/altura da tirinha (canvas).
- Lista de camadas (nome, ordem, visibilidade).
- Lista de quadros (índice; duração se vier, ignorada no MVP).
- Para cada interseção (camada × quadro): célula com pixels (ou ausente, se vazia no `.aseprite`).

### 2.3 Mapeamento pra entidades

A estrutura parseada vira entidades do banco (ver `modelo-de-dados.md`):

- Uma linha em `fe_tirinha` (origem `upload` ou `asset`).
- Uma linha em `fe_camada` por camada do `.aseprite`. Nome e ordem preservados. Visibilidade preservada.
- Uma linha em `fe_quadro` por quadro do `.aseprite`. Índice preservado.
- **Uma linha em `fe_celula` para cada interseção camada × quadro**, sempre — mesmo quando a célula é vazia no `.aseprite`. Célula vazia entra com `png_url = NULL`, `largura = NULL`, `altura = NULL`. Cardinalidade da tabela é sempre C × Q.

### 2.4 Geração dos PNGs

Cada célula não-vazia parseada é renderizada pelo front como PNG (canvas → blob), e enviada ao servidor pra upload no GCS. Após upload, o front grava em `fe_celula.png_url` a URL retornada (forma curta `st.did.lu/...`, conforme `storage.md`).

Células vazias **não geram PNG**. Ficam só como linha com `png_url = NULL`.

### 2.5 Atomicidade

A importação é uma operação. Se algum passo falhar (parsing inválido, upload falhando), nada persiste — nem `fe_tirinha`, nem dependências. O user vê erro e tenta de novo.

A persistência efetiva acontece em transação no servidor depois que todos os PNGs subiram com sucesso.

## 3. Exportação

### 3.1 Disparo

Exportação é sempre **on-demand**, disparada por ação do user:

- "Download" → gera, sobe pro GCS, dispara download no navegador.
- "Publicar como novo asset" → gera, entrega à área Assets pra criar asset novo do lado dela.

Não há geração proativa. Ver `storage.md` §4.2.

### 3.2 Geração

O front lê o estado atual da tirinha (camadas, quadros, células com seus PNGs) e monta o `.aseprite`:

- Cada `fe_camada` vira camada do arquivo, com nome e ordem preservados.
- Cada `fe_quadro` vira quadro do arquivo.
- Cada `fe_celula` não-vazia vira célula no `.aseprite`, com pixels obtidos a partir do PNG (carregado da URL, decodificado em canvas, convertido pro formato interno do `.aseprite`).
- Cada `fe_celula` vazia (`png_url = NULL`) vira **célula ausente** no `.aseprite` — mesmo modelo do Aseprite desktop pra quadro vazio numa camada.

### 3.3 Fidelidade

A exportação é **fiel ao estado da tirinha**. Não há "modos" de exportação no Frames Editor — não há "exportar como referência", "exportar como arte final", "achatar camadas", "remontar". O `.aseprite` que sai reflete exatamente as camadas, quadros e células que estão no banco, com nomes e ordem preservados.

Reorganizações por convenção (camadas `ref`/`draw`, achatamento) são responsabilidade de **outras áreas** da ferramenta (na publicação de asset pelo Frames Creator, por exemplo). Trazer essa noção pra dentro do Frames Editor confundiria áreas e feriria o desacoplamento.

## 4. Renderização no canvas (durante edição)

Visualização do quadro selecionado no canvas do editor segue a mesma lógica de composição que o `.aseprite` usaria na exportação: empilha as células do quadro nas camadas visíveis, na ordem definida, com as transparências carregadas dos PNGs.

Como cada célula é um PNG independente carregado por URL pública (cache do CDN), a composição é simples — não há mistura no servidor, não há render farm. O navegador faz tudo.

Células vazias entram como nada (transparência total na pilha).

## 5. Limitações conscientes do MVP

- **Tags, slices, paths, animação com tween** — features avançadas do formato `.aseprite`. MVP **ignora na importação** (lê e descarta) e **não gera na exportação**. Se um `.aseprite` importado tinha tags, ao exportar de volta as tags não aparecem mais. Ver §6.
- **Duração por quadro** — o formato suporta. MVP ignora (todo quadro vira igual). Se entrar no futuro, é coluna nova em `fe_quadro` (`duracao_ms`), parser/gerador passa a ler/escrever.
- **Modos de cor não-RGBA** (indexed, grayscale) — MVP assume RGBA. Conversão automática se necessário, sem expor a decisão ao user.
- **Camadas agrupadas (groups)** — `.aseprite` permite hierarquia de camadas. MVP achata em lista plana. Se entrar no futuro, é coluna `pai_id` em `fe_camada`.

## 6. Princípio de fidelidade parcial

Importar e exportar de volta **não garante arquivo idêntico**. O Frames Editor preserva o que entende (camadas, quadros, células, nomes, ordem, visibilidade) e descarta o resto. Quem precisa de fidelidade total no `.aseprite` (com tags, slices, etc.) trabalha no Aseprite desktop — esse é parte do trade-off do editor online.

A exportação é fiel **ao estado interno do Frames Editor**, não ao `.aseprite` original que entrou.

## 7. O que não está aqui

- **Lib JS específica usada** — decisão de implementação. Doc fica agnóstico; rodada de implementação escolhe.
- **Performance / streaming de arquivos grandes** — MVP assume tirinhas pequenas. Se aparecer arquivo gigante, decisão entra em rodada própria.
- **Validação de `.aseprite` corrompido** — front mostra erro genérico de parsing e aborta importação. Diagnóstico fino fica fora do MVP.
