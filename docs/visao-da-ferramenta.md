# Visão da Ferramenta — roto-master

Última atualização: 2026-05-03 (patch v2). **Status: visão de produto fechada. Arquitetura técnica e schema ainda não definidos.**

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

## 6. Os dois "lugares" da ferramenta

A home global do app é a **lista de projetos do usuário**. A partir dela:

### Assets (entrada principal de um projeto)
Tela que se vê ao entrar num projeto. Lista de assets do projeto. Sem filtro padrão — mostra todos. Filtros rápidos disponíveis acima da lista (ex: "pendentes", "feitos") + ordenação padrão "mais recentes". Os nomes dos status são renomeáveis pelo time conforme descobrirem o que serve melhor.

### Workbench (espaço de fabricação — do usuário, atravessa projetos)
Acessada via menu global (não fica dentro de projeto). Onde se produz tudo. Subseções:
- Vídeos
- Personagens
- Enquadramentos
- Câmeras salvas
- Ação destacada: **+ Criar vídeo** com escolha de fluxo:
  - **A: Upload** (já implementado parcialmente)
  - **B: URL** (espaço reservado na UI, implementação adiada)
  - **C: Genérico via IA** (espaço reservado na UI, implementação adiada)
  - **D: Caminho personagem** (detalhado em `modulo-personagem.md`)

Recursos da workbench podem ser baixados/exportados individualmente. Mas o destino primário é alimentar assets via **publicação**.

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

## 11. Documentos relacionados

- `modulo-personagem.md` — detalha o Fluxo D (caminho personagem). Esta visão é a referência mestra; aquele doc é especialização.
- `PROGRESS.md` — estado atual de implementação da ferramenta.
- `prototype-v1-personagem/` — protótipo navegável v1, preservado como referência histórica do Fluxo D (estética Atelier 2087 + viewport 3D + presets de câmera reaproveitáveis).
- `prototype/` — protótipo navegável v2 refletindo esta visão (a ser produzido).
- App em produção: https://roto.did.lu

## 12. Próximos passos do produto

Antes de qualquer descida pra arquitetura técnica:
1. Refazer o protótipo navegável refletindo esta visão (Assets como entrada, Workbench acessada via menu, recursos independentes/reusáveis, fluxos A-D todos visíveis).
2. Validar a visão com o protótipo navegável.
3. Só então: schema de dados, endpoints, ordem de implementação.
