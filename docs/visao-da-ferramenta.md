# Visão da Ferramenta — roto-master

Última atualização: 2026-05-03. **Status: visão de produto fechada. Arquitetura técnica e schema ainda não definidos.**

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
   └─ tem acesso a → PROJETOS
                       │
                       ├─ ASSETS (entregáveis em produção)
                       │   │   estágios: a fazer / em andamento / feito
                       │   │   cada asset = 1 produção de rotoscopia
                       │   │   referencia 1 vídeo (do qual será gerado)
                       │   │   ao publicar: gera arquivo final (.aseprite hoje)
                       │   │
                       │   └─ republicar sobrescreve o mesmo asset
                       │
                       └─ WORKBENCH (espaço de fabricação)
                           │
                           ├─ Vídeos (uploaded, URL, gerado-genérico, gerado-de-personagem)
                           ├─ Personagens (independentes — reusáveis entre vídeos)
                           ├─ Enquadramentos (independentes — reusáveis entre personagens)
                           └─ Câmeras salvas (presets do projeto)
```

### Notas importantes sobre cada entidade

**Projeto** — entidade obrigatória. Todo asset, todo recurso, vive dentro de um projeto. Permissão é deste nível.

**Asset** — o entregável. Tem estágios (a fazer / em andamento / feito). Aponta pra **um vídeo** que é a fonte. Quando publicado, gera o arquivo final (`.aseprite`) e o disponibiliza pra download (provavelmente via GCS). Republicar o mesmo asset sobrescreve o arquivo. Asset é a interface principal pro artista que vai rotoscopar.

**Vídeo** — recurso da workbench. Tem origem tipada (`uploaded` | `url` | `generated-generic` | `generated-from-character`). Quando origem é `generated-from-character`, referencia o personagem e o enquadramento que o originaram. Outras origens não têm essas referências. Um vídeo pode existir sem virar asset (rascunho, exploração).

**Personagem** — recurso da workbench. Existe independente de vídeos. Tem múltiplas variações de aparência (filosofia exploratória). Reusável: o mesmo personagem alimenta vários vídeos.

**Enquadramento** — recurso da workbench. Existe independente de personagens. Especifica **câmera + composição** (posição, rotação, FOV, framing). É produzido no viewport 3D (humanoide neutro Mixamo + manipulação de câmera). Pode ser usado com qualquer personagem. **Não é uma foto** — é uma especificação de câmera. A imagem gerada que combina personagem + enquadramento é um produto derivado, não o enquadramento em si.

**Câmera salva** — preset reutilizável de posição/rotação/FOV. Salvas no nível do projeto. Aparecem na lista de presets ao trabalhar em qualquer enquadramento daquele projeto.

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

### Assets (entrada principal)
A primeira tela que se vê ao entrar num projeto. Lista de assets do projeto, com filtros por estágio. Atende:
- Artista que vem rotoscopar — filtra "a fazer", clica, edita, marca feito.
- Quem prepara — vê o estado geral da entrega do projeto.

### Workbench (espaço de fabricação)
Acessada via menu/botão. Onde se produz tudo. Subseções:
- Vídeos
- Personagens
- Enquadramentos
- Câmeras salvas
- Ação destacada: **+ Criar vídeo** (escolha de fluxo: upload, URL, genérico via IA, ou caminho personagem)

Recursos da workbench podem ser baixados/exportados individualmente (não são prisioneiros do fluxo) — mas o foco é que eles alimentem assets.

## 7. O ato de publicar (asset ↔ vídeo)

Vídeo na workbench é exploração livre. Não obriga a virar nada.

**Publicar** é o ato que promove um vídeo editado a asset:
1. Workbench → vídeo → editor → "publicar como asset"
2. Sistema gera o `.aseprite` final, sobe pro storage (GCS), cria/atualiza um asset entregável.
3. Asset aparece na lista de Assets, disponível pro artista.

**Republicar:** editar o mesmo vídeo e publicar de novo **sobrescreve** o mesmo asset (não cria novo). A relação asset ↔ vídeo é estável; o que muda é a versão do `.aseprite` exportado.

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
3. Workbench é espaço de fabricação; assets é vitrine de entrega.
4. Publicar é ato deliberado; nem todo vídeo precisa virar asset.
5. Republicar sobrescreve o mesmo asset.
6. Personagens, enquadramentos e câmeras são recursos independentes e reutilizáveis.
7. UI é assimétrica: Assets é entrada principal; Workbench é acessada via menu.
8. Permissão é por projeto, sem granularidade interna. Quem entra, faz tudo.
9. Nomenclatura: "Workbench" (não "Material", "Resources"). "Enquadramento" (não "shot").
10. Custo previsto antes de cada geração; modelos trocáveis por etapa.
11. Filosofia exploratória: variações se acumulam, não se apagam (descarte é estado implícito).
12. Hierarquia de prompt embutida — usuário só fornece intenção criativa.

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
- Protótipo navegável da v1 (não bate com esta visão final, foi feito antes desta consolidação): `prototype/`
- App em produção: https://roto.did.lu

## 12. Próximos passos do produto

Antes de qualquer descida pra arquitetura técnica:
1. Refazer o protótipo navegável refletindo esta visão (Assets como entrada, Workbench acessada via menu, recursos independentes/reusáveis, fluxos A-D todos visíveis).
2. Validar a visão com o protótipo navegável.
3. Só então: schema de dados, endpoints, ordem de implementação.
