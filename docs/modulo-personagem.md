# Módulo Personagem — Documento de Produto

Última atualização: 2026-05-02. **Status: produto fechado, técnica ainda não definida.**

Este documento descreve o fluxo, telas e decisões de produto do módulo de **rotoscopia para personagem** do roto-master. É a referência de produto pra implementação. Não contém arquitetura técnica, schema, ou escolhas de stack — isso será documentado separadamente depois que este documento for aprovado.

---

## 1. Posicionamento

O roto-master deixa de ser **um editor** (usuário traz o vídeo) e passa a ser **um estúdio de referência de animação 2D guiado por IA** (usuário traz uma intenção de personagem e sai com material pronto pra rotoscopar).

O módulo Personagem é o primeiro pipeline opinionado dessa nova geração. A rotoscopia genérica (upload de vídeo, URL) continua existindo mas mora separada — não é foco desta versão.

## 2. Público e contexto de uso

- **Público:** time interno de artistas. Ferramenta fechada, não pública.
- **Concorrência:** baixa (poucos artistas), não é preocupação técnica nem de UX nesta versão.
- **Fluxo:** opinionado. A ferramenta impõe sequência e estrutura — esse é o produto, não uma limitação.

## 3. Princípios que governam o módulo

1. **Etapas obrigatórias e sequenciais.** Não se pula. Não se atalha. A obrigatoriedade é o que mitiga alucinação — é o produto.
2. **Cada etapa é exploratória dentro de si.** Múltiplas variações por etapa, todas guardadas, navegáveis em árvore.
3. **Hierarquia de prompt é responsabilidade da ferramenta.** O artista descreve intenção criativa. As constantes técnicas obrigatórias são injetadas invisivelmente.
4. **Custo previsto antes de cada geração.** Toda ação que gasta dinheiro mostra o valor antes do clique.
5. **Modelo trocável por etapa.** Catálogo de modelos é cidadão de primeira classe — dirige a UI.
6. **Nada se apaga.** Estados implícitos (favorito, neutro, descartado) substituem destruição.

## 4. As três etapas geradoras + rotoscopia

```
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 1 — APARÊNCIA                                          │
│ "Quem é esse personagem?"                                    │
│ Input:  prompt textual + estilo                              │
│ Output: imagem(ns) do personagem em pose neutra frontal      │
│ Modelo: nano-banana-pro (default), trocável                  │
│ Custo:  ~$0.04 / geração                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 2 — ENQUADRAMENTO                                      │
│ "Como eu olho pra ele?"                                      │
│ Input:  aparência aprovada + viewport 3D (câmera definida)   │
│ Output: pose 2D do personagem no ângulo exato                │
│ Modelo: nano-banana-pro (default), trocável                  │
│ Custo:  ~$0.04 / geração                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 3 — MOVIMENTO                                          │
│ "O que ele faz?"                                             │
│ Input:  pose enquadrada + prompt de ação + duração           │
│ Output: vídeo curto (i2v) do personagem performando a ação   │
│ Modelo: Kling 2.5 Turbo Pro i2v (default), trocável          │
│ Custo:  ~$0.35 / geração de 5s                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 4 — ROTOSCOPIA                                         │
│ Editor existente. Sem mudança conceitual.                    │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Hierarquia de prompt (a parte invisível)

Cada etapa monta o prompt final do modelo assim:

```
[constantes técnicas obrigatórias da etapa]
+ [escolhas estruturadas do usuário (preset, dropdown, viewport)]
+ [texto livre do usuário (intenção criativa)]
```

**Etapa 1 — constantes:**
`full body, standing upright, neutral pose, arms relaxed, plain neutral background, soft even lighting, character centered, no props in hands`

**Etapa 2 — constantes:**
`same character as reference image, full body in frame, neutral pose, plain neutral background, locked-off camera`
+ screenshot do viewport 3D como referência adicional de composição

**Etapa 3 — constantes:**
`same character and camera angle as reference, locked-off camera, no camera movement, single continuous action`

O artista nunca vê as constantes. Vê só o que ele controla.

## 5. Modelo de dados (conceitual): árvore de exploração

Cada personagem é uma árvore navegável. Todos os nós persistem, todos são reutilizáveis.

```
[Personagem: "Cavaleiro Órfico"]
│
├─ aparências geradas
│   ├─ 🟢 v1   ← favorita atual
│   ├─    v2
│   ├─    v3
│   └─    v4 (descartada — gerou versões melhores depois)
│
└─ baseado na aparência v1:
    │
    ├─ enquadramentos
    │   ├─ 🟢 lateral v1   ← favorito atual
    │   ├─    lateral v2
    │   ├─ 🟢 3/4 frente v1
    │   └─    frontal v1
    │
    └─ baseado em "lateral v1":
        │
        └─ movimentos
            ├─ 🟢 "andando" v1   → vai pra rotoscopia
            ├─    "andando" v2
            ├─ 🟢 "soco" v1      → vai pra rotoscopia
            └─    "guarda" v1
```

**Propriedades importantes:**

- Nada se apaga, tudo se acumula.
- Cada nó tem estado implícito: **favorito** (escolhido pelo artista), **neutro**, ou **descartado** (some do principal mas continua na árvore).
- Trocar a favorita de uma etapa anterior **não invalida** os nós filhos. Eles continuam ligados à versão antiga e podem ser navegados a qualquer momento.
- A etapa 4 (rotoscopia) consome um nó-folha de movimento. Cada vídeo aprovado vira um projeto de rotoscopia próprio.

## 6. Telas

### 6.1 Tela 1 — Lista de personagens (home do módulo)

```
┌──────────────────────────────────────────────────────────────┐
│  roto-master                              manu@did.lu  [sair]│
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   PERSONAGENS                              [+ novo personagem]│
│                                                               │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│   │ [thumb]  │  │ [thumb]  │  │ [thumb]  │  │ [thumb]  │    │
│   │          │  │          │  │          │  │          │    │
│   │ Cavaleiro│  │ Mago     │  │ Bandido  │  │ Bruxa    │    │
│   │  Órfico  │  │ Solar    │  │ Ratão    │  │  Cinza   │    │
│   │ 3 mov.   │  │ 1 mov.   │  │ 5 mov.   │  │ —        │    │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                               │
│   ── Outros vídeos (uploads soltos) ──                       │
│   (futuro: rotoscopia genérica vai morar aqui)               │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

- Thumb do card = aparência favorita atual do personagem.
- Subtítulo = quantos movimentos já foram aprovados pra rotoscopia.
- Click no card abre a Tela 2 (workspace daquele personagem).
- Personagem novo: cria sem nome, artista renomeia depois (fluxo exploratório, descobre o nome ao ver o personagem).

### 6.2 Tela 2 — Workspace do personagem (tela principal)

Onde o artista passa 90% do tempo. Três colunas, uma por etapa, materializa a árvore na tela.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ‹ voltar      Cavaleiro Órfico                              [renomear] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─ APARÊNCIA ──────────┐  ┌─ ENQUADRAMENTO ─────┐  ┌─ MOVIMENTO ─────┐│
│  │                       │  │                       │  │                  ││
│  │  [thumb] 🟢 v1       │  │  [thumb] 🟢 lateral v1│  │  [▶thumb] 🟢 walk││
│  │  [thumb]    v2       │  │  [thumb]    lateral v2│  │  [▶thumb]    walk││
│  │  [thumb]    v3       │  │  [thumb] 🟢 3/4 v1   │  │  [▶thumb] 🟢 punch││
│  │                       │  │  [thumb]    frontal v1│  │  [▶thumb]    guard││
│  │  ─────────            │  │                       │  │                  ││
│  │  [+ gerar variação]  │  │  ─────────            │  │  ─────────       ││
│  │                       │  │  [+ gerar variação]  │  │  [+ gerar movim.]││
│  │                       │  │                       │  │                  ││
│  │                       │  │  (mostrando filhos    │  │  (mostrando filhos││
│  │                       │  │   de "aparência v1") │  │   de "lateral v1")││
│  └───────────────────────┘  └───────────────────────┘  └──────────────────┘│
│                                                                          │
│   Selecionado: aparência v1 → lateral v1 → walk v1   [→ rotoscopar]    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Como se lê:**

- Coluna esquerda lista todas as aparências do personagem.
- Coluna do meio lista todos os enquadramentos da **aparência selecionada**.
- Coluna direita lista todos os movimentos do **enquadramento selecionado**.
- Trocar seleção numa coluna atualiza as colunas à direita.
- Barra inferior mostra o "caminho atual" e botão pra mandar pra rotoscopia.
- Nós descartados ficam ocultos por padrão, com toggle "mostrar histórico" pra recuperar.

### 6.3 Tela 3 — Diálogo de geração de APARÊNCIA (etapa 1)

```
┌──────────────────────────────────────────────────────────────┐
│  Gerar nova APARÊNCIA                                    [×] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Modelo:    [ nano-banana-pro    ▼ ]   Custo estimado: $0.04 │
│                                                               │
│  Estilo:    ( ) realismo  (•) semi-realista  ( ) cartoon     │
│                                                               │
│  Descrição do personagem:                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ cavaleiro órfico, armadura preta gasta, capa         │   │
│  │ vermelha rasgada, cabelos brancos longos, olhar duro │   │
│  │                                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ▸ Ver prompt completo (que será enviado ao modelo)          │
│                                                               │
│                              [cancelar]  [gerar — $0.04]     │
└──────────────────────────────────────────────────────────────┘
```

### 6.4 Tela 4 — Diálogo de ENQUADRAMENTO (etapa 2) — viewport 3D

A grande inovação dessa versão. O artista posiciona uma câmera real sobre um humanoide neutro 3D, vê **exatamente** o que vai pedir pra IA gerar.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ENQUADRAMENTO — Cavaleiro Órfico, baseado em aparência v1           [×]│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─ presets de câmera ─┐  ┌─ viewport 3D ─────────────────────────┐   │
│  │                       │  │                                        │   │
│  │  ▸ Top-down           │  │       [humanoide Mixamo neutro]      │   │
│  │  ▸ Isométrico         │  │       em A-pose, cinza, sem detalhes │   │
│  │  ▸ Side-scroller      │  │                                        │   │
│  │  ▸ 3ª pessoa          │  │       câmera ativa renderiza          │   │
│  │  ▸ 1ª pessoa          │  │       view atual                      │   │
│  │  ▸ Frontal            │  │                                        │   │
│  │  ▸ Costas             │  │       grade chão pra referência       │   │
│  │  ▸ Low-angle herói    │  │                                        │   │
│  │  ▸ Plongé dramático   │  │       [orbit:  drag mouse]            │   │
│  │                       │  │       [pan:    shift+drag]            │   │
│  │  ─── meus presets ──  │  │       [zoom:   scroll]                │   │
│  │  ▸ "Câmera inimigo"   │  │                                        │   │
│  │  ▸ "Boss view"        │  │                                        │   │
│  │                       │  │                                        │   │
│  │  [+ salvar atual]     │  └────────────────────────────────────────┘   │
│  │                       │                                               │
│  │  Câmera atual:        │   Ajustes adicionais (opcional):             │
│  │  ▸ FOV:    [50° ─●─] │   ┌──────────────────────────────────────┐  │
│  │  ▸ Altura: livre      │   │ inclinado pra frente, espada erguida │  │
│  │  ▸ Dist:   livre      │   └──────────────────────────────────────┘  │
│  │                       │                                               │
│  │                       │   Modelo: [nano-banana-pro ▼]   $0.04        │
│  │                       │                                               │
│  └───────────────────────┘                  [cancelar] [gerar — $0.04]  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Como funciona o viewport:**

- Carrega humanoide Mixamo neutro (A-pose, cinza, sem características) — reaproveita asset de `~/ved/random-experiments/skeleton-animation/assets/character.fbx`.
- Câmera começa no preset default (Side-scroller / lateral).
- Artista clica em qualquer preset → câmera anima até a posição canônica.
- Artista pode orbitar/pan/zoom livremente a partir de qualquer ponto.
- Slider de FOV ajusta abertura.
- Botão "salvar atual" cria preset customizado nomeado, fica disponível pra outros personagens do mesmo projeto.

**O que vai pra IA quando aperta "gerar":**

1. Screenshot do viewport (humanoide + câmera + framing) — referência de composição.
2. Imagem da aparência aprovada na etapa 1 — referência de identidade.
3. Prompt textual (constantes + ajustes opcionais).

A IA recebe **dupla referência visual** e gera a pose 2D fiel ao ângulo definido.

### 6.5 Tela 5 — Diálogo de MOVIMENTO (etapa 3)

```
┌──────────────────────────────────────────────────────────────┐
│  Gerar MOVIMENTO — baseado em "lateral v1"               [×] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Modelo:    [ Kling 2.5 Turbo Pro i2v   ▼ ]                  │
│  Duração:   [ 5s ▼ ]                  Custo estimado: $0.35  │
│                                                               │
│  Pose inicial:                                                │
│  ┌──────────────┐                                            │
│  │  [thumb da   │  ← lateral v1, fixa como pose inicial      │
│  │   pose 2D]   │                                            │
│  └──────────────┘                                            │
│                                                               │
│  Ação que o personagem performa:                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ dá dois passos à frente, saca a espada da bainha,    │   │
│  │ fica em postura de guarda                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ▸ Ver prompt completo                                        │
│                                                               │
│                              [cancelar]  [gerar — $0.35]     │
└──────────────────────────────────────────────────────────────┘
```

- Custo recalcula ao trocar modelo ou duração.
- Pose inicial é fixa (vem do contexto da árvore) — não tem upload manual aqui.

### 6.6 Estado "gerando…"

Geração de imagem é rápida (~5–10s), aceita modal com spinner.

Geração de vídeo é longa (~60s) e precisa de tratamento que não bloqueie:

- O nó já aparece na coluna correspondente como placeholder com badge "gerando…".
- Artista pode fechar o diálogo, navegar pelo workspace, gerar outras coisas em paralelo (jobs paralelos não travam UI, embora servidor execute em sequência por enquanto).
- Quando termina, placeholder vira thumb/preview real, com pulso visual sutil pra chamar atenção.
- Se falhar: nó marcado como "falhou" + motivo + botão "tentar de novo com os mesmos parâmetros".

### 6.7 Tela 6 — Editor de rotoscopia (existente, sem mudança conceitual)

Header passa a mostrar contexto: `Cavaleiro Órfico → lateral v1 → walk v1`.
Botão "‹ voltar ao personagem" leva pra Tela 2 (workspace).

## 7. Catálogo de presets de câmera (versão inicial)

Presets pensados pra uso comum em games. Lista evolutiva — fácil adicionar novos.

| Preset             | Uso típico                                  |
|--------------------|---------------------------------------------|
| Top-down           | RPG estilo Zelda clássico, twin-stick       |
| Isométrico         | Diablo, Hades, isométricos clássicos        |
| Side-scroller      | Plataforma 2D, beat'em up                   |
| 3ª pessoa          | Sobre o ombro, action-adventure             |
| 1ª pessoa          | FPS, walking sim                            |
| Frontal            | Retrato direto, cutscene, menu              |
| Costas             | Personagem visto por trás, portrait reverso |
| Low-angle herói    | Câmera baixa olhando pra cima — heroico     |
| Plongé dramático   | Câmera alta olhando pra baixo — vulnerável  |

Mais "presets do projeto" salvos pelo artista aparecem em seção separada da lista.

## 8. Catálogo de modelos

Cada modelo é cadastrado com: nome, etapa onde se aplica, custo, parâmetros aceitos.

### Etapa 1 e 2 (geração de imagem)
| Key             | Provider | Custo    | Notas                        |
|-----------------|----------|----------|------------------------------|
| nano-banana-pro | Google   | ~$0.04   | Default, aceita ref de imagem|
| (futuros)       | —        | —        | Cadastrar conforme necessidade|

### Etapa 3 (geração de vídeo i2v)
| Key            | Provider     | Custo/s | Notas                         |
|----------------|--------------|---------|-------------------------------|
| kling-i2v      | fal.ai/Kling | ~$0.07  | **Default**, melhor custo/qualidade |
| kling-t2v      | fal.ai/Kling | ~$0.07  | Sem pose inicial, raramente usado |
| hailuo-i2v     | fal.ai/MiniMax| ~$0.045 | Mais barato, qualidade menor    |
| (futuros: runway, veo, sora) | — | — | Adicionar conforme necessidade |

Cálculo de custo na UI: `custo_por_segundo × duração_escolhida`. Exibido em tempo real ao trocar modelo ou duração.

## 9. Decisões de produto fechadas

- Personagem é entidade de primeira classe, com nome, vida própria, agrupa tudo.
- Três etapas geradoras obrigatórias e sequenciais antes da rotoscopia.
- Hierarquia de prompt embutida na ferramenta — usuário só fornece intenção.
- Cada etapa é exploratória, todos os nós persistem em árvore.
- Filosofia B: tudo se guarda, descarte é estado implícito.
- Etapa 2 usa viewport 3D com humanoide neutro Mixamo + câmera manipulável.
- Presets de câmera são pontos de partida, não destinos.
- Estado da câmera (posição, rotação, FOV) é parte do nó salvo.
- Artista pode salvar câmeras customizadas como presets do projeto.
- Custo previsto antes de cada geração (modelo + parâmetros recalculam em tempo real).
- Modelo trocável por etapa via catálogo de modelos (cidadão de primeira classe).
- Geração de vídeo é assíncrona — não bloqueia o workspace.
- v1 só humanoide (outros bichos depois).
- Pose inicial do humanoide: A-pose.
- Pose-able (manipular o rig) fica fora da v1.
- Edição manual da aparência (upload de imagem corrigida) fica fora da v1.
- Rotoscopia genérica (upload, URL) continua existindo separada, fora deste módulo.

## 10. Decisões de produto adiadas (não nesta versão)

- Pose-able do humanoide na etapa 2.
- Upload manual de imagem editada como nó da árvore.
- Outros tipos de personagem (animais, criaturas).
- Rotoscopia genérica via URL.
- Compartilhamento entre artistas (já que time é pequeno e fechado).
- Versionamento explícito (favoritar/descartar com botão dedicado) — por enquanto é implícito.

## 11. Referências

- Projeto irmão (CLI de geração de vídeo, vai ser absorvido): `~/ved/motion-ref-gen/`
- Asset humanoide Mixamo + experimento Three.js base: `~/ved/random-experiments/skeleton-animation/`
- Skill de geração de imagem: `~/.claude/skills/nano-banana-pro/`
- App em produção: https://roto.did.lu
