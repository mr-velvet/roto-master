# Visão da Ferramenta — roto-master

Última atualização: 2026-05-04 (patch v4 — fecha decisão de detalhe de asset, atualiza estado pós-implementação da v1). **Status: visão de produto fechada. Arquitetura técnica fechada. Fatia mínima da v1 em produção em https://roto.did.lu (pendente: detalhe do asset, ver seção 6.7).**

> **Patch 2026-05-04 (v4 — pós-v1):** após a fatia mínima entrar em produção, ficou claro que o "Detalhe de asset" (seção 6.2 ponto 5) precisava de decisão, não podia continuar "futura" — sem ele o asset vira card sem ação e quebra os princípios "asset é cidadão central" e a regra 4 da seção 6.6. Decisão fechada em 6.2 (modal) e detalhada na nova seção 6.7. Seção 11 atualizada: o protótipo `prototype/` é o **terceiro** (refeito em contexto limpo após o patch v3) e está aprovado como referência viva — não foi descartado. Seção 12 reescrita: a fase de protótipo + arquitetura terminou; a fase atual é **fechar a v1 mínima**.
>
> **Patch 2026-05-04 (v3 — antidelírio):** seção 6 (UI) reescrita com decisões cruas; seção 6.1 (metáfora do ateliê) adicionada como modelo mental obrigatório; seção 6.5 (anti-padrões de UI) adicionada listando explicitamente o que NÃO pode aparecer, com exemplo do erro real ocorrido em 2026-05-04 ao construir o primeiro protótipo v2. Resto da visão inalterado.
>
> **Patch 2026-05-03 (v2):** decisões consolidadas em conversa de produto. Mudanças principais: workbench passa a ser do **usuário**, não do projeto; asset vinculado a projeto **só no momento da publicação**; relação **1:1** entre vídeo e asset (reuso = duplicar vídeo); republicação **sobrescreve** sem histórico; vídeos do Fluxo D são **snapshots imutáveis**; Fluxos B (URL) e C (genérico) ficam com **espaço reservado na UI** mas implementação adiada. Detalhes nas seções 4, 6, 7 e 9.

Este documento descreve **a visão completa** da ferramenta roto-master: o que ela é, quem usa, como está estruturada conceitualmente, e como cada parte se conecta. É a referência mestra de produto. Documentos específicos de cada módulo (ex: `modulo-personagem.md`) devem ser lidos no contexto desta visão.

Se este documento conflita com qualquer outro doc de produto, **este vence**.

---

## 1. O que a ferramenta é

Roto-master é uma **esteira de produção de assets de rotoscopia**. O entregável final é sempre um arquivo pronto pra um artista desenhar em cima sem trabalho técnico adicional — hoje `.aseprite` (rotoscopia em pixel art), no futuro outros formatos.

A ferramenta é um **canivete suíço** que cobre toda a esteira:

1. **Conseguir o vídeo** — várias maneiras (upload, URL, geração genérica via IA, geração estruturada via fluxo de personagem).
2. **Editar o vídeo** — corte, fps, scale, efeitos WYSIWYG (já existe).
3. **Publicar como asset entregável** — exportar `.aseprite` finalizado e disponibilizar pra artistas (parcialmente existe).

Importante: **o módulo personagem é uma das maneiras de conseguir vídeo**, não é o produto. É um caminho otimizado para um caso comum (animação de personagem). A ferramenta serve igualmente bem outros casos (cenários, partículas, referência humana real captada externamente).

## 2. Público

Time interno de artistas e quem prepara material pra eles. Sem distinção formal de papéis hoje — todos fazem um pouco dos dois (preparar + rotoscopar). Sem permissionamento granular: quem está num projeto vê e faz tudo daquele projeto.

Acesso via Google login (Logto, já implementado). Permissão é por projeto.

## 3. Princípios duradouros

1. **Asset é o cidadão central da ferramenta.** Tudo gira em torno de produzir assets entregáveis. "Tarefa" não é entidade — é um asset em estágio inicial.
2. **Workbench é espaço de fabricação.** Onde se cria o que vai virar asset. Exploração livre, sem cerimônia.
3. **Publicar é ato deliberado.** Nem todo vídeo precisa virar asset. O artista (ou preparador) decide o que vale a pena entregar.
4. **Hierarquia de prompt é responsabilidade da ferramenta.** Quando há geração por IA, o usuário descreve intenção criativa. Constantes técnicas são injetadas invisivelmente.
5. **Custo previsto antes de cada geração.** Toda ação que gasta dinheiro mostra o valor antes do clique.
6. **Modelo trocável por etapa.** Catálogo de modelos é cidadão de primeira classe.
7. **Etapas exploratórias acumulam, não destroem.** Versões antigas continuam acessíveis (filosofia de exploração, descarte é estado implícito).
8. **Acoplamento mínimo entre conceitos.** Recursos da workbench são reutilizáveis: um personagem pode alimentar muitos vídeos, um enquadramento pode ser usado com vários personagens.

## 4. Estrutura de entidades

```
USUÁRIO (Google login via Logto)
   │
   ├─ WORKBENCH (espaço de fabricação — pertence ao usuário, não ao projeto)
   │   │
   │   ├─ Vídeos (uploaded, URL, gerado-genérico, gerado-de-personagem)
   │   ├─ Personagens (reusáveis entre vídeos)
   │   ├─ Enquadramentos (reusáveis entre personagens)
   │   └─ Câmeras salvas (presets do usuário)
   │
   └─ tem acesso a → PROJETOS
                       │
                       └─ ASSETS (entregáveis publicados)
                           cada asset = 1 vídeo publicado
                           relação 1:1 entre vídeo e asset
                           ao publicar: gera arquivo final (.aseprite hoje)
                           republicar sobrescreve o mesmo asset
                           reuso = duplicar o vídeo na workbench
                                   (duplicata sai sem vínculo a projeto)
```

**Mudança importante (patch v2):** workbench é do **usuário**. Tudo que se fabrica é pessoal até o ato de publicar — a primeira publicação de um vídeo escolhe o projeto-destino e cria o asset. A partir daí o vínculo é estável (republicar sobrescreve). Pra publicar o "mesmo trabalho" em outro projeto, duplica o vídeo na workbench e publica a duplicata.

### Notas importantes sobre cada entidade

**Projeto** — agrupa assets entregues. Um projeto só recebe vídeos via publicação (não tem workbench própria). Permissão de acesso é deste nível (v1: o dono é o único acessante; multi-usuário por projeto fica adiado).

**Asset** — o entregável. Vive dentro de um projeto. Aponta pra **um vídeo** (1:1 — não há reuso de vídeo entre assets; reuso = duplicar). Tem status renomeáveis (v1 inicial: "pendente / feito" — nomes podem mudar conforme o time descobrir). Quando publicado, gera o arquivo final (`.aseprite`) e o disponibiliza pra download via GCS. Republicar sobrescreve o arquivo (sem histórico de versões).

**Vídeo** — recurso da workbench (do usuário). Tem origem tipada (`uploaded` | `url` | `generated-generic` | `generated-from-character`). Quando origem é `generated-from-character`, é **snapshot imutável**: guarda referência ao personagem/enquadramento/movimento que o originaram, mas continua válido mesmo se esses recursos forem descartados depois. Um vídeo pode existir indefinidamente sem virar asset (rascunho, exploração). **Duplicar vídeo** é operação de primeira classe — produz um novo vídeo independente (sem vínculo a projeto, mesmo que o original já tenha sido publicado).

**Personagem** — recurso da workbench (do usuário). Existe independente de vídeos. Tem múltiplas variações de aparência (filosofia exploratória). Reusável: o mesmo personagem alimenta vários vídeos.

**Enquadramento** — recurso da workbench (do usuário). Existe independente de personagens. Especifica **câmera + composição** (posição, rotação, FOV, framing). É produzido no viewport 3D (humanoide neutro Mixamo + manipulação de câmera). Pode ser usado com qualquer personagem. **Não é uma foto** — é uma especificação de câmera. A imagem gerada que combina personagem + enquadramento é um produto derivado, não o enquadramento em si.

**Câmera salva** — preset reutilizável de posição/rotação/FOV. Salvas no nível do **usuário**. Aparecem na lista de presets em qualquer enquadramento que o usuário esteja produzindo.

### Sobre nomenclatura: "shot" foi descartado

Considerou-se "shot" pra enquadramento, mas "shot" sugere foto/imagem capturada. O conceito real é **especificação de câmera** — posição, rotação, FOV. **Enquadramento** captura melhor isso. A imagem gerada (personagem visto naquele enquadramento) é produto derivado, não o enquadramento.

## 5. Os fluxos de produção (todos válidos)

Todos os fluxos terminam no mesmo lugar: um asset publicado como `.aseprite` pronto pra artista.

### Fluxo A — vídeo já existe
```
Workbench: upload .mp4 → editor de vídeo → publicar como asset
```

### Fluxo B — vídeo de URL
```
Workbench: paste URL → download → editor → publicar como asset
```

### Fluxo C — geração genérica (não-personagem)
```
Workbench: prompt + modelo → vídeo → editor → publicar como asset
```

### Fluxo D — caminho personagem (opinionado, otimizado)
```
Workbench:
  1. Gerar/escolher personagem (ou usar existente)
  2. Definir/escolher enquadramento (ou usar existente)
  3. Combinar personagem + enquadramento → imagem-pose
  4. Gerar vídeo (i2v) a partir da pose + prompt de movimento
  5. Editor de vídeo
  6. Publicar como asset
```

O Fluxo D é detalhado no doc `modulo-personagem.md`. **Os passos 1, 2 e 3 produzem recursos persistentes na workbench** — todos reutilizáveis, todos com filosofia exploratória (múltiplas variações guardadas).

## 6. Arquitetura de UI

> **Atenção:** esta seção é a parte mais propensa a interpretação errada do documento inteiro. Em 2026-05-04, ao construir o primeiro protótipo v2, eu (Claude) inventei UI sem suporte na visão (botão "workbench" repetido no header de toda tela, dropdown rotulado "workbench" abrindo as 4 subseções como se fossem peers, header genérico de app sem hierarquia clara). Resultado: usuário não entendia o que era asset, o que era workbench, nem qual a relação. **Antes de produzir qualquer UI, ler 6.1 (metáfora) e 6.5 (anti-padrões).**

### 6.1 Metáfora obrigatória — Ateliê e Galeria

A ferramenta tem **dois lugares**, e só dois. Eles não são peers. Não estão no mesmo nível. Pensar como peers (ex: dois itens de menu lado a lado) já é o erro.

**O Ateliê (Workbench)** é onde o artista fabrica. É o espaço pessoal, bagunçado por princípio, cheio de rascunhos, variações, materiais semi-acabados. Vídeos, personagens, enquadramentos, câmeras salvas — tudo isso são *materiais e ferramentas do artista*. Ninguém mais entra aqui. Não há projeto aqui.

**A Galeria (Projetos com seus Assets)** é onde o artista entrega. É público (dentro do time), organizado, com obras prontas (ou em vias de). Cada projeto é uma sala da galeria com suas obras (assets). Cada obra aponta de volta pra um material específico do ateliê (1:1 vídeo↔asset).

**A ponte entre Ateliê e Galeria é o ato de publicar.** Não há outra forma de algo entrar na galeria. Não há "projeto que contém workbench própria". Não há "asset que existe sem ter sido publicado".

Quando a gente diz "Assets é entrada principal", a gente quer dizer: *o usuário entra na ferramenta pela galeria*. A galeria é o que ele vê primeiro porque é o que importa pro time. O ateliê é privado, acessado quando o artista decide ir trabalhar.

### 6.2 Mapa das telas (sem ambiguidade)

Existem cinco telas principais. Sem mais, sem menos.

1. **Home global** — lista de projetos do usuário. É a primeira tela após login.
2. **Detalhe de projeto** — lista de assets do projeto. Entrada principal de cada projeto.
3. **Ateliê (Workbench)** — quatro subseções, cada uma é uma tela: Vídeos, Personagens, Enquadramentos, Câmeras salvas.
4. **Editor de vídeo** — tela cheia, onde se edita um vídeo do ateliê e se aciona "publicar como asset".
5. **Detalhe de asset** — modal sobre a tela de detalhe do projeto (decisão fechada no patch v4; ver 6.7).

Não existe "tela de workbench como container das 4 subseções". As 4 subseções **são** a workbench. Quando o usuário está em "Ateliê → Vídeos", ele já está no ateliê. Não há um lugar a mais a alcançar.

### 6.3 Como se entra em cada lugar

- **Home global** → clique em projeto → **Detalhe do projeto**.
- **Home global** ou **Detalhe do projeto** → clique em "Ateliê" no menu global → cai numa das 4 subseções (a que estava ativa por último, ou Vídeos por padrão).
- **Detalhe do projeto** → clique em asset → abre detalhe do asset.
- **Detalhe do asset** → clique em "abrir editor" → **Editor**.
- **Ateliê → Vídeos** → clique em vídeo → **Editor**.
- **Editor** → clique em "publicar como asset" → modal de publicação → ao confirmar, vai pro **Detalhe do projeto** correspondente.

**O menu global é a única forma de alternar entre Galeria e Ateliê.** Não existem atalhos contextuais "ir pra workbench" no header de cada tela. O menu já é a forma. Repetir é poluição.

### 6.4 O que tem em cada tela (e o que NÃO tem)

**Home global**
- Tem: lista de projetos (cards), botão criar projeto.
- Não tem: nenhuma referência ao ateliê além do menu global. Sem "atalho rápido pra criar vídeo", sem "últimos vídeos da workbench". A home global é sobre projetos, ponto.

**Detalhe do projeto**
- Tem: nome do projeto, lista de assets, filtros rápidos (sem filtro padrão; sugestões: "todos", "pendentes", "feitos") + ordenação ("mais recentes" padrão).
- **Não tem botão "+ novo asset"**. Asset não nasce aqui. Asset nasce no ateliê e é publicado aqui. O que pode existir é uma chamada-de-ação convidando "ir pro ateliê e publicar um vídeo aqui" — se houver, deve estar redigida explicando o fluxo, não fingindo ser um botão de criação.
- Não tem botão "workbench" duplicado. O menu global já tem.

**Ateliê → Vídeos**
- Tem: grid de vídeos do usuário, ação destacada "+ criar vídeo" (que abre o seletor de fluxos A/B/C/D).
- Cada vídeo mostra: nome, origem (upload/URL/genérico/personagem), duração, indicador se já foi publicado e em qual projeto.
- Não tem: filtros por projeto. A workbench não conhece projeto.

**Ateliê → Personagens, Enquadramentos, Câmeras salvas**
- Cada uma é uma tela própria, com sua lista e sua ação de criar.
- Não tem subnavegação interna que repita o nome "workbench".

**Editor**
- Tem: vídeo em tela grande, transport com in/out, parâmetros (fps/scale), presets de efeito, botão "publicar como asset".
- Tem header global persistente com breadcrumbs. Breadcrumbs mostram de onde se veio (de um projeto ou do ateliê).
- Não tem: botão "voltar pro projeto X" duplicado em vários cantos. O breadcrumb já é o caminho de volta.

**Detalhe do asset (modal)** — ver seção 6.7 pra detalhamento.
- Tem: preview, nome, status (chip clicável que alterna pendente↔feito), vínculo visível com o vídeo-fonte, ação "baixar `.aseprite`", ação "abrir editor pra re-editar".
- Não tem: histórico de versões (republicar sobrescreve, conforme decisão 6); "atribuir a artista" (decisão adiada na seção 10); botão "novo asset" (asset nasce no ato de publicar, não aqui).

### 6.5 Anti-padrões de UI (proibidos)

Lista de coisas que **não pode acontecer**, com explicação de por que cada uma é erro. Esta lista nasceu do delírio real ocorrido em 2026-05-04 ao construir o primeiro protótipo v2. Se o protótipo (ou produto) tem qualquer um desses padrões, **descartar e refazer**.

1. **Botão "workbench" no header de toda tela.** O menu global já dá acesso ao ateliê. Repetir transforma "workbench" em ação contextual em vez de lugar. Errado.

2. **Dropdown rotulado "Workbench" que abre uma lista com [Vídeos, Personagens, Enquadramentos, Câmeras salvas].** Este é o erro mais grave. Faz "workbench" parecer um peer das suas próprias subseções, como se fosse um item entre outros. A workbench *é* o conjunto das quatro. Se o menu precisa mostrar as quatro subseções, ele lista as quatro diretamente — ou abre numa tela do ateliê com as subseções visíveis como navegação interna.

3. **Botão "+ novo asset" no detalhe do projeto.** Asset não nasce aqui. Asset nasce na publicação. Botão sugere ação errada.

4. **Card de "novo projeto" no meio do grid de projetos** (visualmente igual aos projetos existentes). Confunde criar com selecionar. Botão de criação fica fora do grid, com afordância clara de ação.

5. **"Atalho pra criar vídeo" na home global de projetos.** Home global é sobre projetos. Misturar com criação de material no ateliê apaga a distinção entre os dois lugares.

6. **Header genérico estilo "app SaaS" com logo + N atalhos contextuais.** A ferramenta tem um modelo mental específico (Galeria + Ateliê). O chrome global deve refletir esse modelo: identidade da ferramenta, indicação de em qual lugar se está (projeto X / ateliê), e o ponto de troca entre os dois lugares. Mais que isso é ruído.

7. **Asset apresentado como "tarefa" com checkbox visível.** Asset é entregável. Status é metadata. UI não pode parecer Trello.

8. **Conceito "asset" sem que ele apareça em algum momento como uma forma visível e tangível.** Se o usuário entra na ferramenta e em nenhum lugar vê "este é um asset", a entidade central virou abstração técnica. Cada asset deve ter representação visual que comunique "isto é uma obra entregue ou em vias de" (preview, miniatura, indicador de estado).

9. **Workbench tratada como "configurações" ou "biblioteca técnica".** Workbench é o lugar de trabalho criativo. Deve sentir como ateliê (rico, exploratório), não como settings panel.

### 6.6 Regra geral de validação de UI

Antes de aprovar qualquer protótipo ou tela, perguntar:

1. **Onde está o usuário agora?** Galeria ou Ateliê? A tela responde isso em 1 segundo?
2. **Como ele veio parar aqui?** O caminho está visível (breadcrumb ou lugar equivalente)?
3. **Asset é visível como conceito?** O entregável aparece como objeto tangível na interface, não só como linha de tabela?
4. **A relação asset ↔ vídeo está visível** quando relevante (ex: detalhe de asset mostra qual vídeo é fonte; detalhe de vídeo mostra se já virou asset e em qual projeto)?
5. **O ato de publicar é deliberado?** Tem ritual visual (modal, confirmação), não é checkbox que aciona algo poderoso sem o usuário perceber?
6. **Tem algum elemento de UI que aparece "por padrão de SaaS" e não por necessidade desta ferramenta?** Se sim, remover.

Se qualquer resposta for não, voltar antes de avançar.

### 6.7 Detalhe do asset (modal)

Decisão fechada no patch v4: **modal** sobre a tela de Detalhe do projeto, não tela própria. Razões:

- **Não tira o usuário do contexto.** Ele está inspecionando obras de uma sala da galeria; um modal é olhar de perto sem sair da sala.
- **Asset não tem subnavegação.** Tela própria sugere que tem mais coisa pra explorar dentro dele — não tem. É um entregável simples (status, vídeo-fonte, arquivo final, ação).
- **Custa menos atenção.** ESC fecha. Volta imediato pra grid de assets pra inspecionar o próximo.

**O que o modal mostra**, em ordem visual de cima pra baixo:

1. **Eyebrow + nome do asset.** Eyebrow indica de onde se está olhando ("Galeria · Projeto X"). Nome em tipografia de obra (mesma família dos títulos de projeto).
2. **Preview.** Idealmente miniatura/thumbnail real da rotoscopia ou do vídeo-fonte. Enquanto isso não existe, marca tipográfica grande (não o losango ◇ genérico) que comunica "obra".
3. **Chip de status, clicável.** Alterna `pendente ↔ feito` direto. Sem dropdown, sem submenu. Reflete na lista atrás imediatamente.
4. **Vínculo com o vídeo-fonte (cumpre regra 4 da 6.6).** Linha tipo "fonte: nome do vídeo no Ateliê" com seta. Clicar nela leva pro editor daquele vídeo.
5. **Ações primárias:**
   - **Baixar `.aseprite`** — ação principal, link direto pro `gcs_url` do asset.
   - **Re-editar** — equivalente a clicar no vídeo-fonte; vai pro editor. Republicar ali sobrescreve este asset (já implementado no backend).
6. **Metadata discreta** (rodapé do modal): versão atual, data de publicação, quem publicou.
7. **Ação destrutiva escondida** (não destacada): "despublicar asset" — apaga o asset, vídeo volta a ser rascunho na workbench. Comportamento conservador: não apaga o vídeo-fonte. Pede confirmação.

**O que o modal NÃO tem:**

- **Atribuição a artista** (decisão adiada na seção 10).
- **Histórico de versões** (republicar sobrescreve, conforme decisão 6).
- **Comentários, threads, conversa.** Asset é entregável, não tarefa de Trello (anti-padrão 7 da 6.5).
- **Edição direta do nome.** Renomeia se necessário (clicar no nome alterna pra input). Mas não é foco.

**Comportamento do card de asset na grid (Detalhe do projeto):**

- **Click no card** → abre modal.
- **Card mostra**: preview, nome, status (chip não-clicável, só visual), data, **selo discreto da origem do vídeo** (upload/url/genérico/personagem) — comunica "esta obra veio de qual fluxo".
- **Hover** revela dois atalhos canto inferior: `↓` (baixar `.aseprite` direto, sem abrir modal) e `↗` (abrir editor direto).

## 7. O ato de publicar (asset ↔ vídeo)

Vídeo na workbench é exploração livre, do usuário. Não pertence a projeto nenhum até ser publicado.

**Publicar** é o ato que promove um vídeo a asset:
1. Workbench → vídeo → editor → "publicar como asset"
2. Na primeira publicação: usuário escolhe o **projeto-destino** (ou cria um novo).
3. Sistema gera o `.aseprite`, sobe pro GCS, cria o asset no projeto.
4. Asset aparece na lista do projeto.

A partir da primeira publicação, o vídeo fica vinculado ao projeto/asset. **Republicar sobrescreve** o `.aseprite` no GCS (sem histórico de versões — primeira versão simples).

**Reuso em outro projeto:** duplicar o vídeo na workbench. A duplicata sai sem vínculo a projeto e pode ser publicada em qualquer outro. O vídeo original e a duplicata são independentes a partir da duplicação — editar um não afeta o outro.

## 8. O que dura nessa visão

Esta estrutura aguenta sem refatoração:
- Outros tipos de asset além de rotoscopia (ex: spritesheets gerados, cycles prontos) → `asset.type` + editor por tipo.
- Workbench ganha novas seções (áudios, texturas, modelos 3D) → encaixa naturalmente.
- Outros formatos de saída além de `.aseprite` (GIF, PNG sequence, sprite atlas) → `asset.export_format`.
- Atribuição explícita de assets a artistas → `asset.assignee`.
- Dependências entre assets → `asset.depends_on`.
- Templates de asset (presets de fps/scale) → preset aplicado na criação.
- Mais modelos de IA, mais provedores → catálogo expandido.
- Animais, criaturas, outros tipos de personagem → `personagem.type`.

Nenhuma dessas evoluções pede repensar Assets vs Workbench. Esse é o teste de durabilidade.

## 9. Decisões de produto fechadas

1. Roto-master é esteira completa de produção de assets de rotoscopia, não só editor.
2. Asset é cidadão central; tarefa é estado, não entidade separada.
3. Workbench é espaço de fabricação **do usuário** (atravessa projetos); assets vivem dentro de projetos.
4. Publicar é ato deliberado; nem todo vídeo precisa virar asset. Na primeira publicação se escolhe o projeto-destino.
5. Relação **1:1** entre vídeo e asset. Reuso = duplicar vídeo na workbench (duplicata sai sem vínculo).
6. Republicar sobrescreve o `.aseprite` (primeira versão sem histórico).
7. Personagens, enquadramentos e câmeras são recursos independentes e reutilizáveis.
8. Vídeos do Fluxo D são snapshots imutáveis — guardam referência a personagem/enquadramento mas sobrevivem ao descarte deles.
9. UI: home = lista de projetos. Dentro do projeto: Assets é entrada principal. Workbench acessada via menu global (não fica dentro de projeto).
10. Lista de assets sem filtro padrão; filtros rápidos ("pendentes", "feitos") + ordenação "mais recentes". Status renomeáveis.
11. Editor de vídeo abre em tela cheia, com header global (breadcrumbs + menu) pra voltar.
12. Fluxos B (URL) e C (genérico) têm espaço reservado na UI mas implementação adiada.
13. v1: usuário só vê os próprios projetos/recursos. Multi-usuário por projeto fica adiado.
14. Nomenclatura: "Workbench" (não "Material", "Resources"). "Enquadramento" (não "shot").
15. Custo previsto antes de cada geração; modelos trocáveis por etapa.
16. Filosofia exploratória: variações se acumulam, não se apagam (descarte é estado implícito).
17. Hierarquia de prompt embutida — usuário só fornece intenção criativa.

## 10. Decisões adiadas (não nesta versão)

- Permissionamento granular dentro do projeto.
- Atribuição explícita de assets a artistas.
- Pose-able do humanoide na produção de enquadramentos.
- Edição manual da aparência (upload de imagem corrigida).
- Outros tipos de personagem além de humanoide.
- Rotoscopia genérica via URL como fluxo destacado (cabe no fluxo B mas sem otimizações).
- Outros formatos de saída além de `.aseprite`.
- Histórico de versões publicadas do mesmo asset (hoje sobrescreve).

## 11. Documentos relacionados e estado dos protótipos

### Documentos
- `arquitetura-tecnica.md` — espelho técnico desta visão (entidades, endpoints, GCS, jobs, fluxo de publicação como transação). Régua: time interno pequeno, sem cerimônia de SaaS.
- `modulo-personagem.md` — detalha o Fluxo D (caminho personagem). Esta visão é a referência mestra; aquele doc é especialização.
- `PROGRESS.md` — estado vivo da implementação.

### Protótipos
- `prototype-v1-personagem/` — primeiro protótipo, foco no módulo personagem isolado. **Preservado** como referência histórica do Fluxo D (estética Atelier 2087 + viewport 3D + presets de câmera reaproveitáveis quando o Fluxo D for implementado de verdade).
- `prototype/` — **terceiro protótipo, aprovado como referência viva da UI da ferramenta inteira.** Histórico: o segundo protótipo foi tentado em 2026-05-04 e descartado por violar os anti-padrões da seção 6.5; o patch v3 desta visão nasceu desse fracasso; em seguida o protótipo foi refeito do zero em contexto limpo, lendo a seção 6 antes, e este terceiro está vivo. A v1 em produção espelha decisões dele (alternador binário, transição animada entre espaços, sidebar do Ateliê listando subseções diretamente, asset como objeto tangível).

### Produção
- App em produção: https://roto.did.lu (login Google, multi-user via Logto).

## 12. Próximos passos do produto

A fase de visão + protótipo + arquitetura técnica está fechada. A v1 mínima está em produção mas **não está completa** — falta o **detalhe do asset** (seção 6.7), sem o qual o asset vira card sem ação e o princípio "asset é cidadão central" fica quebrado.

A ordem de produto pra fechar a v1 está em `PROGRESS.md`. Em uma frase: **fechar o detalhe do asset (modal da 6.7) é prioridade um**, antes de qualquer extensão. Depois disso a v1 está formalmente entregue e pode-se atacar v2 (Fluxo D, jobs/Gerações, Fluxos B/C, share link).

### Checklist obrigatório antes de produzir UI nova

Marcar cada item antes de escrever qualquer HTML/CSS/JS de tela:

- [ ] Li seção 6 inteira (incluindo anti-padrões 6.5 e detalhe do asset 6.7).
- [ ] Sei dizer em uma frase a diferença entre Galeria (Projetos+Assets) e Ateliê (Workbench).
- [ ] Sei dizer por que "workbench" não pode aparecer como botão repetido em headers.
- [ ] Sei dizer onde nasce um asset (resposta única: ato de publicar).
- [ ] Identifiquei se a tela que vou construir é da Galeria, do Ateliê, ou trânsito (editor).
- [ ] Para cada elemento de UI que penso adicionar, perguntei "isso aparece porque é necessidade desta ferramenta ou porque é padrão de SaaS?".
