# Visão da Ferramenta — roto-master

Última atualização: 2026-05-07 noite (patch v7 — três áreas macro + colaboração extrema. (a) Renomeação Ateliê → **Frames Creator**; surgimento do **Frames Editor** como terceira área macro irmã (não subseção); Galeria continua como **Assets**. (b) **Nada é do usuário**: tudo na plataforma é coletivo; quem tem o token vê e mexe em tudo. Removida toda noção de "workbench pessoal", "espaço pessoal", "meus vídeos". Banco é a fonte da verdade; visibilidade não tem filtro por usuário. (c) **Tirinha** elevada a entidade nomeada da Frames Creator (renomear toggle "Rotoscopia" → "Quadros" no editor de vídeo; refazer pede confirmação modal). (d) Ciclo com artista é **não-linear**: `.aseprite` vai e volta livremente, dois modos de export (como referência ou como arte final). (e) Frames Editor como área isolada documentada em `docs/frame-editor.md` — **única ponte com o resto é o arquivo `.aseprite`**. (f) Metáfora "ateliê pessoal" abandonada — não cabe mais. Seções 1, 3, 4, 6, 7, 9 reescritas; seção 12 atualizada.)

> **Patch 2026-05-07 noite (v7 — três áreas + colaboração extrema):** duas viradas grandes. **Primeira:** a ferramenta deixa de ser dois lugares (Galeria/Ateliê) e passa a ser três áreas macro irmãs: **Assets** (entrega), **Frames Creator** (produção de quadros a partir de vídeo — renomeação do Ateliê), **Frames Editor** (edição direta de `.aseprite`, isolada, comunicando com o resto só por arquivo). Frames Editor não é subseção do Frames Creator; é peer. **Segunda:** a noção de "workbench pessoal" é abandonada — **nada na plataforma é do usuário**. Quem tem o token vê e mexe em tudo. A régua antiga "espaço pessoal vs público" desaparece; toda fricção que separava "meu" de "do outro" é antipattern. Banco é a única fonte da verdade. Edição simultânea por múltiplos agentes é direção futura aceita pela arquitetura conceitual. Detalhamento do Frames Editor em `docs/frame-editor.md`. Tirinha vira entidade nomeada da Frames Creator com identidade própria. Ciclo com artista é não-linear (`.aseprite` vai e volta sem ordem prescrita). Para arquivos `.aseprite` exportados, dois modos: quadros como referência (modelo atual) ou quadros como arte final.
>
> **Patch 2026-05-07 (v6 — definição ampliada):** a definição da seção 1 estava estreita ("esteira de produção de assets de rotoscopia"), o que limitava o pensamento de produto. Reescrita pra refletir o que a ferramenta faz: parte de um vídeo (gerado nela ou trazido) e oferece funcionalidades pra criar animações em cima dele — quebrar em quadros, manipular tempo, aplicar efeitos, estilizar (vídeo inteiro ou quadro a quadro), exportar arquivo pra artista, receber arquivo trabalhado de volta e continuar. Rotoscopia clássica vira um caso de uso. Seção 5 (fluxos) ampliada pra mostrar funcionalidades combináveis em vez de fluxos fechados. Seção 7 reescrita pra incluir o ciclo "exporta → artista trabalha → volta pra ferramenta". Seção 3 ganha princípio "etapas opcionais, nenhuma substitui outra". Seção 13 do patch v5 removida (ela só existia porque a seção 1 estava estreita). Seção 6.5 limpa de anti-padrões inventados.
>
> **Patch 2026-05-04 (v4 — pós-v1):** após a fatia mínima entrar em produção, ficou claro que o "Detalhe de asset" (seção 6.2 ponto 5) precisava de decisão, não podia continuar "futura" — sem ele o asset vira card sem ação e quebra os princípios "asset é cidadão central" e a regra 4 da seção 6.6. Decisão fechada em 6.2 (modal) e detalhada na nova seção 6.7. Seção 11 atualizada: o protótipo `prototype/` é o **terceiro** (refeito em contexto limpo após o patch v3) e está aprovado como referência viva — não foi descartado. Seção 12 reescrita: a fase de protótipo + arquitetura terminou; a fase atual é **fechar a v1 mínima**.
>
> **Patch 2026-05-04 (v3 — antidelírio):** seção 6 (UI) reescrita com decisões cruas; seção 6.1 (metáfora do ateliê) adicionada como modelo mental obrigatório; seção 6.5 (anti-padrões de UI) adicionada listando explicitamente o que NÃO pode aparecer, com exemplo do erro real ocorrido em 2026-05-04 ao construir o primeiro protótipo v2. Resto da visão inalterado.
>
> **Patch 2026-05-03 (v2):** decisões consolidadas em conversa de produto. Mudanças principais: workbench passa a ser do **usuário**, não do projeto; asset vinculado a projeto **só no momento da publicação**; relação **1:1** entre vídeo e asset (reuso = duplicar vídeo); republicação **sobrescreve** sem histórico; vídeos do Fluxo D são **snapshots imutáveis**; Fluxos B (URL) e C (genérico) ficam com **espaço reservado na UI** mas implementação adiada. Detalhes nas seções 4, 6, 7 e 9.

Este documento descreve **a visão completa** da ferramenta roto-master: o que ela é, quem usa, como está estruturada conceitualmente, e como cada parte se conecta. É a referência mestra de produto. Documentos específicos de cada módulo (ex: `modulo-personagem.md`) devem ser lidos no contexto desta visão.

Se este documento conflita com qualquer outro doc de produto, **este vence**.

---

## 1. O que a ferramenta é

Roto-master é uma ferramenta que parte de um vídeo (gerado nela ou trazido) e oferece um conjunto de funcionalidades pra criar animações em cima dele. O material base é sempre vídeo; o objetivo final é uma animação produzida com a combinação dessas funcionalidades, de trabalho IA, e de trabalho manual do artista (dentro ou fora da ferramenta).

A ferramenta é organizada em **três áreas macro irmãs**, sem subordinação entre elas:

- **Assets** — projetos com seus assets entregáveis. Entrada principal pro time. Cada asset é um trabalho que foi promovido a entregável e tem o `.aseprite` correspondente disponível pra download/upload.
- **Frames Creator** — produção de quadros a partir de vídeo. Onde se obtém o vídeo, manipula, e quebra em **tirinha** (sequência de quadros congelada com identidade própria). Tirinha publicada vira asset.
- **Frames Editor** — edição direta de arquivos `.aseprite`. **Área isolada**: não conhece projetos, vídeos ou tirinhas como entidades; apenas lê e escreve arquivos `.aseprite`. A única ponte com o resto da ferramenta é o arquivo. Detalhada em `docs/frame-editor.md`.

Funcionalidades que a ferramenta oferece (nem todas implementadas — algumas são v1, outras direção futura), distribuídas entre as três áreas:

- **Obter vídeo** (Frames Creator) — upload de arquivo, URL externa, geração via IA (genérica ou estruturada por personagem/enquadramento/movimento).
- **Manipular o vídeo** (Frames Creator) — cortar (in/out), mudar fps, mudar velocidade, aplicar efeitos WYSIWYG.
- **Quebrar o vídeo em tirinha** (Frames Creator) — gera entidade própria (a tirinha) com seus quadros congelados, validada como fluxo de animação naquela taxa de quadros.
- **Publicar como asset** (Assets) — promove uma tirinha a entregável dentro de um projeto, gerando o `.aseprite` correspondente.
- **Editar `.aseprite` na ferramenta** (Frames Editor) — visualizar tirinha, edição manual quadro-a-quadro, estilização IA (vídeo inteiro, intervalo ou quadro único), composição. Entra `.aseprite`, sai `.aseprite`.
- **Trabalhar `.aseprite` fora** (Aseprite desktop ou similar) — caminho paralelo. O artista escolhe o editor onde quer trabalhar a cada momento; a ferramenta não impõe.
- **Exportar `.aseprite` em modos diferentes** — quadros como referência (artista vai desenhar do zero por cima) ou quadros como arte final (estado já trabalhado vai como camada principal).

Rotoscopia clássica (vídeo vira referência intocada, artista desenha do zero) é **um caso de uso** dessa combinação — não a definição da ferramenta. Outros casos: estilização IA com retoque manual no Frames Editor; ciclo de ida-e-volta com Aseprite desktop; uso do Frames Editor como sandbox antes do Aseprite desktop; partir direto de um `.aseprite` qualquer no Frames Editor sem passar por vídeo.

Hoje o entregável é `.aseprite`. No futuro pode ser outros formatos.

**O módulo personagem** é uma das maneiras de obter vídeo (geração estruturada) dentro da Frames Creator, não é o produto. A ferramenta serve igualmente bem casos sem personagem.

## 2. Público e modelo de acesso

Time interno pequeno de artistas e quem prepara material pra eles. Sem distinção formal de papéis — todos fazem um pouco de tudo.

**Modelo de acesso colaborativo extremo:** quem tem o token compartilhado da plataforma vê e mexe em tudo. **Nada na plataforma é do usuário** — não há "meus vídeos", "meu projeto", "minha tirinha", "meu `.aseprite`". O banco é a única fonte da verdade do que existe; a visibilidade não tem filtro por usuário.

Esse modelo é deliberado:

- O time tem projetos pra entregar e a ferramenta precisa ser usada **agora**. Burocracia de permissão (membros, papéis, ownership) custou tempo desproporcional comparado ao tamanho real do time. Removida.
- Edição simultânea por múltiplos agentes na mesma tirinha é direção futura aceita pela arquitetura conceitual (não está implementada na v1, mas o modelo já não traz a fricção que a impediria).
- Princípio durável: **toda fricção que separa "meu" de "do outro" é antipattern**. A ferramenta favorece colaboração ao extremo.

A coluna `owner_sub` que existe no banco em algumas tabelas (cicatriz histórica do modelo anterior com Logto/owner) está NULL-able e não é mais lida nem escrita pelo código. Permanece apenas como artefato.

## 3. Princípios duradouros

1. **Asset é o cidadão central da ferramenta.** Tudo gira em torno de produzir assets entregáveis. "Tarefa" não é entidade — é um asset em estágio inicial.
2. **Nada é do usuário.** Toda visibilidade é coletiva. Banco é a única fonte da verdade. Toda fricção que separa "meu" de "do outro" é antipattern.
3. **Frames Creator é espaço de fabricação coletivo.** Onde se obtém vídeo e se quebra em tirinha. Exploração livre, sem cerimônia, sem ownership pessoal.
4. **Frames Editor é área isolada.** Comunica com o resto só por arquivo `.aseprite`. Não conhece projetos, vídeos, tirinhas. Pode evoluir independentemente.
5. **Publicar é ato deliberado.** Nem todo vídeo/tirinha precisa virar asset. A decisão de promover é consciente.
6. **Etapas opcionais, nenhuma substitui outra.** Cada funcionalidade é uma camada que se aplica ou não. Aplicar uma não apaga a anterior — fica disponível pra voltar, comparar, criar fork. "Tentar de novo" produz alternativa lado a lado, não sobrescrita.
7. **Ciclo com artista é não-linear.** O `.aseprite` vai e volta entre Frames Editor, Aseprite desktop e o asset sem ordem prescrita. Cada ida-e-volta é uma ação consciente; o artista escolhe onde quer trabalhar a cada momento.
8. **Hierarquia de prompt é responsabilidade da ferramenta.** Quando há geração por IA, o usuário descreve intenção criativa. Constantes técnicas são injetadas invisivelmente.
9. **Custo previsto antes de cada geração.** Toda ação que gasta dinheiro mostra o valor antes do clique.
10. **Modelo trocável por etapa.** Catálogo de modelos é cidadão de primeira classe.
11. **Resultados de IA são imutáveis e cacheados.** Mesma combinação (entrada + prompt + modelo + parâmetros) já gerada não cobra de novo. Variações se acumulam, não se sobrescrevem.
12. **Acoplamento mínimo entre conceitos.** Recursos são reutilizáveis: um personagem pode alimentar muitos vídeos, um enquadramento pode ser usado com vários personagens. Frames Editor não conhece nada do resto.
13. **Footprint visível e controlável.** Saber o quanto a ferramenta consome em storage e ter mecanismo (manual ou automatizado) pra varrer e limpar material descartado.

## 4. Estrutura de entidades

```
ÁREA: ASSETS (Galeria — entrega)
   │
   └─ PROJETOS (compartilhados, sem ownership pessoal)
         │
         └─ ASSETS (entregáveis publicados)
             cada asset = 1 tirinha publicada
             ao publicar: gera arquivo .aseprite no GCS
             arquivo .aseprite atual representa o estado da animação
             — pode ter sido produzido pela ferramenta ou subido pelo artista

ÁREA: FRAMES CREATOR (produção de quadros — coletivo)
   │
   ├─ Vídeos (uploaded, URL, gerado-genérico, gerado-de-personagem)
   │     │
   │     └─ Tirinha (sequência de quadros congelada)
   │         tem propriedades próprias (fps, in/out, scale)
   │         seus quadros são entidades visíveis
   │         hoje 1 por vídeo; refazer pede confirmação modal (sobrescreve)
   │         futuro: N por vídeo
   │
   ├─ Personagens (reusáveis entre vídeos)
   ├─ Enquadramentos (reusáveis entre personagens)
   └─ Câmeras salvas (presets coletivos)

ÁREA: FRAMES EDITOR (edição de .aseprite — isolada)
   │
   └─ ÁREA ISOLADA, comunicação só via arquivo .aseprite
      detalhada em docs/frame-editor.md
      modelo de dados próprio, decisões próprias
```

**Princípio do v7:** todas essas entidades são **coletivas**. Não há ownership pessoal. Quem tem o token vê e mexe em tudo. Banco é a única fonte da verdade.

### Notas importantes sobre cada entidade

**Projeto** — agrupa assets entregues. Coletivo (sem owner pessoal). Recebe assets via publicação a partir de tirinhas da Frames Creator.

**Asset** — o entregável. Vive dentro de um projeto. Aponta pra **uma tirinha** (1:1 — não há reuso de tirinha entre assets; reuso conceitual = nova tirinha). Tem status renomeáveis (v1 inicial: "pendente / feito"). Tem `.aseprite` correspondente no GCS, que pode ter sido gerado pela ferramenta ou subido pelo artista (ciclo não-linear). Republicar atualiza o arquivo. **Atalho "abrir no Frames Editor"** carrega o `.aseprite` atual no editor isolado — equivale conceitualmente a baixar e subir manualmente.

**Vídeo** — recurso da Frames Creator. Tem origem tipada (`uploaded` | `url` | `generated-generic` | `generated-from-character`). Quando origem é `generated-from-character`, é **snapshot imutável**: guarda referência ao personagem/enquadramento/movimento que o originaram, mas continua válido mesmo se esses recursos forem descartados. Um vídeo pode existir indefinidamente sem virar tirinha. **Duplicar vídeo** é operação de primeira classe.

**Tirinha** (entidade nova promovida no v7) — sequência de quadros congelada extraída do vídeo de acordo com um conjunto de propriedades (fps, in/out, scale, e os efeitos WYSIWYG aplicados ao vídeo no momento da quebra). Tem identidade própria. Hoje há 1 tirinha por vídeo; o ato de "refazer a tirinha" pede modal de confirmação porque sobrescreve o trabalho anterior. No futuro, N tirinhas por vídeo (várias decupações do mesmo vídeo coexistindo). É a tirinha — não o vídeo — que vira asset ao publicar.

**Quadro** — unidade da tirinha. Tem PNG associado no GCS. Visível, navegável. Pode ter variantes geradas pela Frames Creator (ex: o quadro original extraído do vídeo) ou pelo Frames Editor (ex: estilização IA, edição manual) — mas as variantes do Frames Editor são internas àquela área e só voltam pra Frames Creator/Assets via arquivo `.aseprite`.

**Personagem** — recurso coletivo da Frames Creator. Existe independente de vídeos. Tem múltiplas variações de aparência (filosofia exploratória). Reusável: o mesmo personagem alimenta vários vídeos.

**Enquadramento** — recurso coletivo da Frames Creator. Existe independente de personagens. Especifica **câmera + composição** (posição, rotação, FOV, framing). Produzido no viewport 3D (humanoide neutro Mixamo + manipulação de câmera). Reusável com qualquer personagem. **Não é uma foto** — é uma especificação de câmera.

**Câmera salva** — preset reutilizável de posição/rotação/FOV. Coletivo. Aparece na lista de presets em qualquer enquadramento que se esteja produzindo.

### Sobre nomenclatura: "shot" foi descartado

Considerou-se "shot" pra enquadramento, mas "shot" sugere foto/imagem capturada. O conceito real é **especificação de câmera** — posição, rotação, FOV. **Enquadramento** captura melhor isso. A imagem gerada (personagem visto naquele enquadramento) é produto derivado, não o enquadramento.

## 5. Funcionalidades e fluxo

A ferramenta não tem fluxos fixos. Tem funcionalidades combináveis em torno do material base (o vídeo). Um trabalho usa as funcionalidades que fazem sentido pra ele, na ordem que fizer sentido. As funcionalidades estão distribuídas entre as três áreas macro.

### Frames Creator — obter e preparar o vídeo

- **Obter vídeo:**
  - **Upload** — arquivo `.mp4` local.
  - **URL** — vídeo externo (incluindo YouTube).
  - **Geração genérica via IA** — prompt + modelo de vídeo.
  - **Geração estruturada via personagem** — fluxo opinionado em etapas (personagem → enquadramento → movimento → vídeo). Detalhado em `modulo-personagem.md`. Recursos intermediários (personagens, enquadramentos, câmeras) são reutilizáveis e persistentes.

- **Manipular o vídeo:**
  - Cortar (in/out).
  - Mudar fps.
  - Mudar velocidade (acelerar/desacelerar).
  - Aplicar efeitos WYSIWYG.

- **Quebrar o vídeo em tirinha:**
  - Gera a entidade tirinha com seus N quadros, congelando fps/in/out/scale e os efeitos aplicados.
  - Função: validar o fluxo da animação naquela taxa de quadros — se fica legível, se o timing tá certo.
  - Refazer a tirinha sobrescreve a anterior; pede modal de confirmação.

### Assets — publicar e organizar entregáveis

- **Publicar tirinha como asset** — promove uma tirinha a entregável dentro de um projeto. Gera o `.aseprite` correspondente no GCS.
- **Republicar** — atualiza o `.aseprite` do asset.
- **Subir `.aseprite` trabalhado pelo artista** — substitui o `.aseprite` atual do asset (do artista que trabalhou no Aseprite desktop, ou do Frames Editor com "salvar de volta").
- **Baixar `.aseprite`** em dois modos:
  - **Quadros como referência** — camada `ref` preenchida com a tirinha, camada `draw` vazia. Modelo atual; o artista vai desenhar do zero por cima.
  - **Quadros como arte final** — a tirinha entra como camada principal já trabalhada. Útil quando os quadros já passaram por estilização IA ou edição.
- **Abrir no Frames Editor** — atalho que carrega o `.aseprite` atual do asset no Frames Editor isolado.

### Frames Editor — edição direta de `.aseprite`

Capacidades específicas, listadas só em alto nível aqui (detalhamento em `docs/frame-editor.md`):

- Visualização da tirinha como timeline navegável.
- Edição manual de pixels quadro-a-quadro.
- Estilização IA aplicada a todos os quadros, a um intervalo ou a um quadro específico.
- "Tenta de novo nesse quadro" — gerar variante alternativa.
- Versões coexistentes de um mesmo quadro (caso de exceção, não comum).
- Exportar `.aseprite` (download ou "salvar de volta no asset").

A Frames Editor é isolada: não vê projetos, vídeos ou tirinhas como entidades. Só recebe e devolve arquivo `.aseprite`.

### Casos de uso típicos

Combinações concretas dessas funcionalidades:

- **Rotoscopia clássica** — obter vídeo → manipular → tirinha → publicar como asset → exportar `.aseprite` em modo referência → artista rotoscopa no Aseprite desktop → sobe de volta como `.aseprite` do asset.
- **Estilização IA + retoque** — obter vídeo → tirinha → publicar → abrir no Frames Editor → estilizar todos os quadros → "tenta de novo" em quadros que saíram ruins → salvar de volta no asset → opcionalmente exportar pra artista refinar fora.
- **Trabalho direto no `.aseprite`** — subir `.aseprite` qualquer no Frames Editor → estilizar/editar → baixar.
- **Ida-e-volta múltiplas** — exportar pro Aseprite desktop, voltar, abrir no Frames Editor pra ajustar com IA, voltar pro asset, exportar de novo. Sem ordem prescrita.

## 6. Arquitetura de UI

> **Atenção:** esta seção é a parte mais propensa a interpretação errada do documento inteiro. Em 2026-05-04, ao construir o primeiro protótipo v2, eu (Claude) inventei UI sem suporte na visão (botão "workbench" repetido no header de toda tela, dropdown rotulado "workbench" abrindo as 4 subseções como se fossem peers, header genérico de app sem hierarquia clara). Resultado: usuário não entendia o que era asset, o que era workbench, nem qual a relação. **Antes de produzir qualquer UI, ler 6.1 (modelo de áreas) e 6.5 (anti-padrões).**
>
> **Patch v7 (2026-05-07 noite):** seção reescrita pra refletir três áreas macro irmãs (Assets, Frames Creator, Frames Editor) em vez de duas (Galeria/Ateliê), e a virada "nada é do usuário". Metáfora "ateliê pessoal" abandonada. Anti-padrões atualizados.

### 6.1 Modelo de áreas — três irmãs, sem ownership pessoal

A ferramenta tem **três áreas macro irmãs**. São peers no nível mais alto. Não há subordinação entre elas; não há "a área grande contém a área pequena".

**Assets** — entrega. Onde os projetos vivem com seus assets entregáveis. Entrada principal pro time. Coletivo: qualquer pessoa com o token vê todos os projetos e todos os assets.

**Frames Creator** — produção. Onde se obtém vídeo (upload, URL, geração IA), se manipula, e se quebra em **tirinha** (sequência de quadros congelada). Tirinha publicada vira asset. Coletivo: qualquer pessoa com o token vê todos os vídeos, tirinhas, personagens, enquadramentos.

**Frames Editor** — edição de `.aseprite`. Área isolada. Lê e escreve arquivos `.aseprite`. Não conhece projetos, vídeos, tirinhas. Detalhada em `docs/frame-editor.md`.

**A ponte entre Frames Creator e Assets é o ato de publicar.** Nenhuma outra forma de uma tirinha virar asset.

**A ponte entre Frames Editor e o resto é exclusivamente o arquivo `.aseprite`.** Pode entrar no Frames Editor por upload manual ou por atalho do asset (que carrega o `.aseprite` atual). Pode sair como download ou como "salvar de volta no asset" (que conceitualmente é equivalente a baixar e subir manualmente).

**Princípio do v7 — colaboração extrema:** não há "meus projetos", "meus vídeos", "meu trabalho". Tudo é coletivo. Visibilidade não filtra por usuário. O banco é a única fonte da verdade.

### 6.2 Mapa das telas

Telas principais, agrupadas por área.

**Assets:**
1. **Home global** — lista de projetos. É a primeira tela após login.
2. **Detalhe de projeto** — lista de assets do projeto.
3. **Detalhe de asset** — modal sobre a tela de detalhe do projeto (decisão fechada no patch v4; ver 6.7).

**Frames Creator:**
4. **Vídeos** — grid de vídeos com ação "+ criar vídeo".
5. **Personagens, Enquadramentos, Câmeras salvas** — uma tela cada (futuro próximo).
6. **Editor de vídeo** — tela cheia, onde se edita um vídeo, se quebra em tirinha (botão "Quadros"), e se aciona "publicar como asset".

**Frames Editor:**
7. **Editor de `.aseprite`** — área isolada. Layout e telas internas decididos independentemente em `docs/frame-editor.md`.

### 6.3 Como se entra em cada lugar

- **Home global** → clique em projeto → **Detalhe do projeto**.
- Qualquer tela → clique em "Assets", "Frames Creator" ou "Frames Editor" no alternador global do header → cai na área escolhida.
- **Detalhe do projeto** → clique em asset → abre **Detalhe do asset** (modal).
- **Detalhe do asset** → clique em "re-editar vídeo" → vai pro **Editor de vídeo** correspondente.
- **Detalhe do asset** → clique em "abrir no Frames Editor" → vai pro **Frames Editor** com o `.aseprite` carregado.
- **Frames Creator → Vídeos** → clique em vídeo → **Editor de vídeo**.
- **Editor de vídeo** → toggle "Quadros" mostra a tirinha; ação "publicar como asset" abre modal e ao confirmar leva pro **Detalhe do projeto**.
- **Frames Editor** → upload manual de `.aseprite` ou chegada via atalho do asset.

**O alternador global é a única forma de trocar entre as três áreas.** Não existem atalhos contextuais repetidos no header de cada tela.

### 6.4 O que tem em cada tela (e o que NÃO tem)

**Home global (Assets)**
- Tem: lista de projetos (cards), botão criar projeto. Toda a lista é visível pra qualquer pessoa com o token.
- Não tem: filtros "meus" vs "outros". Não há "meus" — é tudo coletivo.

**Detalhe do projeto (Assets)**
- Tem: nome do projeto, lista de assets, filtros rápidos ("todos", "pendentes", "feitos") + ordenação ("mais recentes" padrão).
- **Não tem botão "+ novo asset"**. Asset nasce no Frames Creator e é publicado aqui. Pode existir uma chamada-de-ação convidando "ir pro Frames Creator", redigida explicando o fluxo.

**Frames Creator → Vídeos**
- Tem: grid de **todos os vídeos da plataforma** (coletivo), ação destacada "+ criar vídeo" (seletor de fluxos A/B/C/D).
- Cada vídeo mostra: nome, origem, duração, indicador se já foi publicado e em qual projeto.
- Não tem: filtros por projeto.

**Frames Creator → Personagens, Enquadramentos, Câmeras salvas**
- Cada uma é uma tela própria, com sua lista coletiva e sua ação de criar.

**Editor de vídeo (Frames Creator)**
- Tem: vídeo em tela grande, transport com in/out, parâmetros (fps/scale), presets de efeito, toggle binário "Vídeo Original / **Quadros**" pra alternar entre o vídeo bruto e a tirinha gerada, botão "publicar como asset".
- Tem header global persistente com breadcrumbs.
- **Renomeação no v7:** o toggle hoje rotulado "Rotoscopia" passa a ser **"Quadros"** — comunica melhor que ali está a tirinha (sequência de quadros congelada), não um conceito vinculado à ação de rotoscopar.
- **Refazer a tirinha pede modal de confirmação** quando já existe uma — sobrescreve o trabalho anterior.

**Detalhe do asset (modal, Assets)** — ver seção 6.7.
- Tem: preview, nome, status, vínculo visível com a tirinha-fonte, ação "baixar `.aseprite`" (em dois modos: como referência ou como arte final), ação "re-editar vídeo" (vai pro editor de vídeo), ação "abrir no Frames Editor", ação "subir `.aseprite` trabalhado" (upload manual).

### 6.5 Anti-padrões de UI (proibidos)

Lista de coisas que **não pode acontecer**, com explicação de por que cada uma é erro. Atualizada no v7 pra refletir três áreas + colaboração extrema.

1. **Atalhos repetidos no header de cada tela** ("ir pro Frames Creator", "ir pros Assets"). O alternador global já dá acesso. Repetir transforma área em ação contextual em vez de lugar.

2. **Dropdown rotulado "Frames Creator" que lista [Vídeos, Personagens, Enquadramentos, Câmeras salvas] como peers da própria área.** Faz a área parecer um peer das suas próprias subseções. Se o menu precisa mostrar as subseções, lista as subseções diretamente.

3. **Botão "+ novo asset" no detalhe do projeto.** Asset nasce na publicação. Sugere ação errada.

4. **Card de "novo projeto" no meio do grid de projetos** (visualmente igual aos projetos existentes). Confunde criar com selecionar.

5. **"Atalho pra criar vídeo" na home global de projetos.** Home global é sobre projetos.

6. **Header genérico estilo "app SaaS"** com logo + N atalhos contextuais. O chrome global deve refletir o modelo de três áreas: identidade da ferramenta, indicação de em qual área se está, e o alternador entre as três.

7. **Asset apresentado como "tarefa" com checkbox visível.** Asset é entregável. Status é metadata. UI não pode parecer Trello.

8. **Conceito "asset" sem que ele apareça como forma visível e tangível.** Cada asset deve ter representação visual que comunique "isto é uma obra entregue ou em vias de".

9. **Frames Creator tratada como "configurações" ou "biblioteca técnica".** É lugar de trabalho criativo, não settings panel.

10. **Filtros "meus" / "outros" / "atribuído a mim".** A plataforma não tem ownership pessoal. Esses filtros não fazem sentido e introduziriam fricção contra o princípio de colaboração extrema. Toda visibilidade é coletiva.

11. **Frases que personalizam ("seu Ateliê", "seu vídeo", "seu projeto").** Texto da UI não pode sugerir ownership pessoal. Redação deve ser neutra ou coletiva ("o vídeo", "este projeto", "a tirinha").

12. **Frames Editor como subseção da Frames Creator** (ex: 5ª subseção do menu lateral). Frames Editor é área macro irmã, não subseção. Aparece no alternador global do topo, ao lado das outras duas.

13. **Salvamento implícito do Frames Editor de volta pro asset** sem ação consciente do usuário. A comunicação entre Frames Editor e o resto é sempre via arquivo `.aseprite` movido por uma ação explícita (download, upload, "salvar de volta" em um clique). Sem mágica de sincronização.

### 6.6 Regra geral de validação de UI

Antes de aprovar qualquer protótipo ou tela, perguntar:

1. **Em qual das três áreas o usuário está agora?** Assets, Frames Creator ou Frames Editor? A tela responde isso em 1 segundo?
2. **Como ele veio parar aqui?** O caminho está visível (breadcrumb ou lugar equivalente)?
3. **Asset é visível como conceito?** O entregável aparece como objeto tangível na interface, não só como linha de tabela?
4. **A relação asset ↔ tirinha está visível** quando relevante? (No detalhe de asset, está claro de qual tirinha/vídeo ele veio?)
5. **O ato de publicar é deliberado?** Tem ritual visual (modal, confirmação), não é checkbox que aciona algo poderoso sem o usuário perceber?
6. **A UI fala em coletivo ou em "meu"?** Toda referência personalizada deve ser eliminada. Não há "meu" na plataforma.
7. **Tem algum elemento de UI que aparece "por padrão de SaaS" e não por necessidade desta ferramenta?** Se sim, remover.
8. **Quando há comunicação entre Frames Editor e o resto, é via arquivo explícito?** Nenhuma sincronização implícita.

Se qualquer resposta for não, voltar antes de avançar.

### 6.7 Detalhe do asset (modal)

Decisão fechada no patch v4 e ampliada no v7: **modal** sobre a tela de Detalhe do projeto, não tela própria. Razões:

- **Não tira o usuário do contexto.** Inspecionar de perto sem sair da grid.
- **Asset não tem subnavegação.** Tela própria sugere que tem mais coisa pra explorar dentro dele — não tem. É um entregável (status, tirinha-fonte, arquivo final, ações).
- **Custa menos atenção.** ESC fecha.

**O que o modal mostra**, em ordem visual de cima pra baixo:

1. **Eyebrow + nome do asset.** Eyebrow indica de onde se está olhando ("Assets · Projeto X").
2. **Preview.** Miniatura real da animação atual (do `.aseprite` corrente, que pode ter sido produzido pela ferramenta ou subido pelo artista).
3. **Chip de status, clicável.** Alterna `pendente ↔ feito` direto.
4. **Vínculo com a tirinha-fonte.** Linha tipo "fonte: tirinha do vídeo X". Clicar leva pro editor de vídeo correspondente, com a tirinha visível.
5. **Ações primárias:**
   - **Baixar `.aseprite`** — em dois modos: **como referência** (modelo atual, `ref` preenchida + `draw` vazia) ou **como arte final** (a tirinha como camada principal já trabalhada).
   - **Re-editar vídeo** — vai pro editor de vídeo. Útil se quiser ajustar in/out, fps, ou refazer a tirinha (com modal de confirmação).
   - **Abrir no Frames Editor** — carrega o `.aseprite` atual no editor isolado.
   - **Subir `.aseprite` trabalhado** — upload manual. Substitui o `.aseprite` atual do asset. Usado quando o artista trabalhou no Aseprite desktop e quer atualizar o asset.
6. **Metadata discreta** (rodapé do modal): versão atual, data da última atualização do `.aseprite`.
7. **Ação destrutiva escondida** (não destacada): "despublicar asset" — apaga o asset (não apaga a tirinha-fonte). Pede confirmação.

**O que o modal NÃO tem:**

- **Atribuição a usuário** (não há ownership pessoal — decisão fechada no v7).
- **Histórico de versões com UI** (republicar sobrescreve; arquivos antigos podem ficar no GCS por acidente, mas a UI não os mostra).
- **Comentários, threads, conversa.** Asset é entregável.
- **"Salvamento automático do Frames Editor"** — abrir no Frames Editor não cria vínculo permanente; voltar pro asset é ação consciente.

**Comportamento do card de asset na grid (Detalhe do projeto):**

- **Click no card** → abre modal.
- **Card mostra**: preview, nome, status, data, selo discreto da origem do vídeo.
- **Hover** revela atalhos: `↓` (baixar `.aseprite` em modo referência direto), e possivelmente `↗` (abrir no Frames Editor direto).

## 7. O ato de publicar e o ciclo com o artista (não-linear)

Vídeo na Frames Creator é exploração livre, coletiva. Não pertence a projeto nenhum até alguém publicar.

### Primeira publicação (tirinha → asset)

**Publicar** promove um trabalho a asset:
1. Frames Creator → vídeo → editor → quebrar em tirinha (toggle "Quadros") → "publicar como asset".
2. Na primeira publicação: escolhe o **projeto-destino** (ou cria um novo).
3. Sistema gera o `.aseprite` correspondente, sobe pro GCS, cria o asset no projeto.
4. Asset aparece na lista do projeto.

A partir da primeira publicação, a tirinha fica vinculada ao asset.

### Ciclo com o artista (não-linear)

O `.aseprite` do asset **não é estado terminal**. É um snapshot do trabalho num formato pra edição. Pode ser trabalhado em **três caminhos paralelos**, em qualquer ordem, quantas vezes for necessário:

- **Caminho A — Aseprite desktop (artista offline).** Baixa o `.aseprite` do asset → trabalha no Aseprite desktop ou similar → sobe o arquivo trabalhado de volta no asset.
- **Caminho B — Frames Editor (online, dentro da plataforma).** Abre o `.aseprite` do asset no Frames Editor → trabalha (estilização IA, edição manual, "tenta de novo nesse quadro") → salva de volta no asset (que é equivalente a baixar e subir manualmente).
- **Caminho C — re-editar o vídeo.** Volta pro editor de vídeo, ajusta in/out, fps, ou refaz a tirinha. Republica.

Os três caminhos podem ser intercalados livremente. O artista escolhe qual caminho fazer sentido a cada momento. Não há ordem prescrita; não há etapa "final".

A ferramenta passa a refletir o `.aseprite` corrente como estado atual da animação (preview animado, etc.) — independentemente de qual caminho produziu o arquivo.

### Republicar e re-trabalho

**Republicar atualiza** o `.aseprite` do asset (a versão antiga fica no bucket por acidente, não como feature de histórico — UI não a mostra).

Se quiser publicar variação em outro projeto, faz nova tirinha (a partir do mesmo vídeo ou de outro) e publica. Cada asset tem seu `.aseprite` próprio, evolui independentemente.

### Modos de exportação do `.aseprite`

Na ação de baixar o `.aseprite` (do asset ou do Frames Editor), há **dois modos**:

- **Quadros como referência** — camada `ref` preenchida com a tirinha, camada `draw` vazia. Modelo da v1 atual. Usado quando o artista vai desenhar do zero por cima.
- **Quadros como arte final** — a tirinha (já trabalhada por IA, edição manual, ou ambas) entra como camada principal. Sem camada de referência, ou com ela só como apoio. Usado quando os quadros já passaram por trabalho que vale ser preservado como arte.

A escolha do modo é consciente, na hora do download.

## 8. O que dura nessa visão

Esta estrutura (três áreas macro, colaboração extrema, tirinha como entidade, ciclo não-linear) aguenta sem refatoração:

- Outros tipos de asset além de tirinha-de-rotoscopia (ex: spritesheets gerados, cycles prontos) → `asset.type` + editor por tipo.
- Frames Creator ganha novos tipos de recurso (áudios, texturas, modelos 3D) → encaixa naturalmente.
- Frames Editor ganha novas capacidades de edição internamente sem afetar o resto (continua comunicando só por `.aseprite`).
- Outros formatos de saída além de `.aseprite` (GIF, PNG sequence, sprite atlas) → `asset.export_format`. O Frames Editor pode ou não absorver esses formatos — decisão própria dele.
- N tirinhas por vídeo → tirinha vira lista, asset escolhe qual tirinha aponta.
- Edição simultânea por múltiplos agentes na mesma tirinha → arquitetura conceitual já aceita (tudo é coletivo); precisa só de mecânica concreta no momento certo.
- Mais modelos de IA, mais provedores → catálogo expandido.
- Animais, criaturas, outros tipos de personagem → `personagem.type`.

Nenhuma dessas evoluções pede repensar as três áreas. Esse é o teste de durabilidade.

## 9. Decisões de produto fechadas

1. Ferramenta é definida pelo material (vídeo) e pelo conjunto de funcionalidades aplicáveis sobre ele. Rotoscopia clássica é um caso de uso, não a definição.
2. **Três áreas macro irmãs**: Assets (entrega), Frames Creator (produção a partir de vídeo), Frames Editor (edição direta de `.aseprite`). Não há subordinação entre elas.
3. **Frames Editor é área isolada.** Comunica com o resto exclusivamente via arquivo `.aseprite`. Modelo de dados, UI e decisões internas dela são independentes do resto. Detalhada em `docs/frame-editor.md`.
4. **Nada na plataforma é do usuário.** Toda visibilidade é coletiva. Banco é a única fonte da verdade. A coluna `owner_sub` no banco é cicatriz histórica, não lida nem escrita.
5. Asset é cidadão central; tarefa é estado, não entidade separada.
6. **Tirinha** é entidade da Frames Creator com identidade própria (propriedades fps/in/out/scale + seus quadros). Hoje 1 por vídeo; refazer pede modal de confirmação porque sobrescreve. N por vídeo é direção futura.
7. Publicar é ato deliberado; nem toda tirinha precisa virar asset. Na primeira publicação se escolhe o projeto-destino.
8. **Ciclo com artista é não-linear.** Três caminhos paralelos: Aseprite desktop, Frames Editor, re-edição do vídeo. Em qualquer ordem, quantas vezes for necessário. Não há etapa "final".
9. **Dois modos de exportação do `.aseprite`**: como referência (camadas `ref`/`draw` modelo atual) ou como arte final (tirinha como camada principal já trabalhada). Escolha consciente na hora do download.
10. Asset é estado vivo, não arquivo congelado: o `.aseprite` corrente do asset reflete o trabalho atual, independente de qual caminho produziu. Pode ser substituído a qualquer momento por upload manual.
11. Relação **1:1** entre tirinha e asset. Reuso conceitual = nova tirinha (do mesmo vídeo ou de outro).
12. Republicar atualiza o `.aseprite` do asset; arquivos antigos podem ficar no bucket por acidente, mas UI não os mostra como histórico.
13. Etapas opcionais e nenhuma substitui outra; sempre possível voltar, comparar, criar fork.
14. **Resultados de IA são imutáveis e cacheados.** Mesma combinação de input já gerada não cobra de novo. Filosofia exploratória: variações se acumulam.
15. Personagens, enquadramentos e câmeras são recursos coletivos independentes e reutilizáveis.
16. Vídeos gerados via fluxo de personagem são snapshots imutáveis — guardam referência a personagem/enquadramento mas sobrevivem ao descarte deles.
17. **GCS continua como storage.** Padrão de nomenclatura versionada na URL (cada mudança = URL nova). **Footprint visível e controlável** — saber quanto consome e ter mecanismo de varredura/limpeza, mesmo que manual no início.
18. Deleção de uma entidade na plataforma deve eventualmente cascatear pra varredura dos arquivos correspondentes no GCS (não necessariamente automático na v1, mas direção aceita).
19. UI: home = lista de projetos (Assets). Frames Creator e Frames Editor acessadas via alternador global no header (que vira ternário).
20. Lista de assets sem filtro padrão; filtros rápidos ("pendentes", "feitos") + ordenação "mais recentes". Status renomeáveis.
21. Editor de vídeo abre em tela cheia, com header global. Toggle "Vídeo Original / Quadros" (renomeado no v7 — antes era "Rotoscopia").
22. **Nomenclatura**: "Frames Creator" (não "Workbench", "Ateliê"). "Frames Editor" (não "Aseprite Editor"). "Tirinha" como entidade. "Quadros" como rótulo do toggle no editor de vídeo. "Enquadramento" (não "shot"). Inglês onde reduz tamanho do nome; português pro resto.
23. Custo previsto antes de cada geração; modelos trocáveis por etapa.
24. Hierarquia de prompt embutida — usuário só fornece intenção criativa.

## 10. Decisões adiadas (não nesta versão)

- Permissionamento granular ou ownership por usuário (decisão deliberada de **nunca implementar** sem mudança de produto).
- Edição simultânea por múltiplos agentes na mesma tirinha (direção aceita conceitualmente; mecânica concreta fora da v1).
- N tirinhas por vídeo (hoje 1, com confirmação ao refazer).
- Histórico de versões publicadas com UI dedicada.
- Pose-able do humanoide na produção de enquadramentos.
- Edição manual da aparência (upload de imagem corrigida).
- Outros tipos de personagem além de humanoide.
- Outros formatos de saída além de `.aseprite`.
- Varredura/limpeza automática do GCS pra entidades deletadas (manual no início; automatização futura).

## 11. Documentos relacionados e estado dos protótipos

### Documentos
- `frame-editor.md` — descreve o Frames Editor como área macro isolada. Comunicação com o resto via `.aseprite`. Detalhamento de funcionalidades, UI e modelo de dados internos é escopo próprio dele.
- `arquitetura-tecnica.md` — espelho técnico desta visão. **Desatualizado em relação ao patch v7** (ainda fala em "workbench do usuário", `owner_sub`, etc.). Será atualizado em rodada própria. Em qualquer conflito entre arquitetura técnica e esta visão, **vence a visão**.
- `modulo-personagem.md` — detalha o Fluxo D (caminho personagem) dentro da Frames Creator. Esta visão é a referência mestra; aquele doc é especialização.
- `PROGRESS.md` — estado vivo da implementação.

### Protótipos
- `prototype-v1-personagem/` — primeiro protótipo, foco no módulo personagem isolado. **Preservado** como referência histórica do Fluxo D (viewport 3D + presets de câmera, reaproveitáveis quando o Fluxo D for implementado de verdade).
- `prototype/` — terceiro protótipo, aprovado anteriormente como referência viva da UI binária Galeria/Ateliê. **Parcialmente desatualizado pelo patch v7**: o alternador binário precisa virar ternário (Assets, Frames Creator, Frames Editor); textos de "ateliê pessoal" precisam ser revistos. As decisões visuais não-relacionadas a ownership pessoal (asset como objeto tangível, transição entre áreas, sidebar listando subseções diretamente) continuam válidas.

### Produção
- App em produção: https://roto.did.lu. Auth simples via token único (`APP_TOKEN`) — quem tem o token vê tudo. Modelo Logto/owner removido em 2026-05-05 (ver PROGRESS.md).

## 12. Próximos passos do produto

A v1 (Galeria/Ateliê com fluxos A, B, C, D, ciclo simples vídeo→tirinha→`.aseprite`) está em produção e funcional. O patch v7 abre uma extensão grande do produto (três áreas + colaboração extrema + Frames Editor como área isolada).

**Direção de produto pra próxima fase:**

1. **Frames Editor — design e implementação** (rodada paralela, fora desta conversa). Decisões internas (modelo de dados, UI, integrações de IA, padrão de storage de quadros, mecânica de versões) são escopo próprio do Frames Editor. Documentado em `docs/frame-editor.md`.

2. **Reorganização da UI atual** pra refletir três áreas no alternador global (de binário pra ternário) e remover toda noção de ownership pessoal nos textos da UI ("seu Ateliê", "seu vídeo", etc.). Renomeação Ateliê → Frames Creator. Renomeação do toggle "Rotoscopia" → "Quadros" no editor de vídeo.

3. **Tirinha como entidade promovida** dentro da Frames Creator. Modal de confirmação ao refazer. (Mudança incremental do que já existe.)

4. **Atualização de `arquitetura-tecnica.md`** pra refletir o v7 (remoção de ownership pessoal do modelo conceitual; tirinha como entidade; relação tirinha↔asset; padrão GCS pra quadros; isolamento do Frames Editor).

5. **Discussão técnica** dos pontos acima (modelo de dados, endpoints, padrão real GCS, varredura/limpeza, jobs assíncronos pra IA em lote no Frames Editor) acontece **em rodadas próprias**, com estes documentos como entrada.

A v1 atual em produção continua válida e correta — esta visão é extensão, não pivot.

### Checklist obrigatório antes de produzir UI nova

Marcar cada item antes de escrever qualquer HTML/CSS/JS de tela:

- [ ] Li seção 6 inteira (incluindo anti-padrões 6.5 e detalhe do asset 6.7).
- [ ] Sei dizer em uma frase a diferença entre Assets, Frames Creator e Frames Editor.
- [ ] Sei dizer por que Frames Editor não pode ser subseção de outra área.
- [ ] Sei dizer onde nasce um asset (resposta única: ato de publicar uma tirinha).
- [ ] Identifiquei em qual das três áreas a tela que vou construir vive.
- [ ] Para cada elemento de UI que penso adicionar, perguntei "isso aparece porque é necessidade desta ferramenta ou porque é padrão de SaaS?".
- [ ] Conferi que nenhum texto da UI personaliza ("seu", "meu", "do usuário"). Tudo é coletivo.
- [ ] Se a tela envolve Frames Editor: a comunicação com o resto está exclusivamente via arquivo `.aseprite`?

