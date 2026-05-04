# Protótipo Navegável v2 — visão completa

Protótipo de validação de produto refletindo `docs/visao-da-ferramenta.md` (patch v2). Não é implementação de produção: dados em memória/localStorage, login decorativo, IA simulada.

## Como rodar

Servidor HTTP estático local. Sem build.

```
cd prototype
npx serve .
```

ou

```
cd prototype
python -m http.server 8080
```

Abre o link que ele imprimir.

## O que tem

### Telas
- **Home global** (`#/`) — lista de projetos do usuário, criação de novo projeto.
- **Projeto** (`#/p/:id`) — lista de assets do projeto, filtros (todos / pendente / feito), ordenação (mais recentes / nome), detalhe de asset em modal.
- **Workbench** — espaço de fabricação do usuário, atravessa projetos:
  - Vídeos (`#/wb/videos`) — grid com badge de origem, ações (abrir, duplicar, apagar).
  - Personagens (`#/wb/characters`) — grid (workspace profundo do personagem mora no protótipo v1).
  - Enquadramentos (`#/wb/framings`) — grid (viewport 3D mora no protótipo v1).
  - Câmeras salvas (`#/wb/cameras`) — lista de presets do usuário.
- **Editor de vídeo** (`#/v/:id`) — tela cheia com header global persistente: stage mock, transport com in/out, parâmetros (fps/scale), presets de efeito, botão "publicar como asset".

### Modais
- **Criar vídeo** — escolha de fluxo: A (upload, disponível), B (URL, em breve), C (genérico via IA, em breve), D (caminho personagem, disponível com fluxo simplificado).
- **Fluxo D simplificado** — escolha de personagem → enquadramento → prompt de movimento + duração + custo previsto. Geração simulada (~2s) cria o vídeo na workbench.
- **Publicar como asset** — escolha de projeto-destino + nome do asset. Republicação mostra qual projeto já tem o vínculo e avisa que sobrescreve.
- **Detalhe de asset** — preview, metadata, toggle de status, atalho pro editor.
- **Detalhe de vídeo** — metadata, ação de duplicar, atalho pro editor, link pro asset publicado (se houver).

### Banner persistente
"MODO PROTÓTIPO — sem chamadas reais à IA, dados em localStorage"

## Decisões de produto refletidas

- Workbench é do usuário, atravessa projetos.
- Asset nasce na publicação. Relação 1:1 entre vídeo e asset.
- Reuso de vídeo entre projetos = duplicar (duplicata sai sem vínculo).
- Republicação sobrescreve o `.aseprite` (sem histórico de versões).
- Filtros padrão de assets: todos. Ordenação padrão: mais recentes.
- Status renomeáveis (hoje "pendente / feito").
- Editor em tela cheia com header global pra navegação.
- Fluxos B (URL) e C (genérico) com placeholder na UI.

## Estrutura

```
prototype/
  index.html          shell + chrome global
  styles.css          base v1 + extensões pra projetos/assets/workbench/editor
  js/
    seed.js           dados iniciais (3 projetos, 6 assets, 8 vídeos, 3 personagens, etc.)
    store.js          localStorage como banco (read + mutate)
    router.js         hash routing
    ui.js             modais custom, toasts, breadcrumbs
    main.js           bootstrap
    views/
      home.js         lista de projetos
      project.js      detalhe de projeto + asset cards + filtros
      workbench.js    4 subseções da workbench + modal "criar vídeo"
      editor.js       editor de vídeo + modal de publicação
```

## O que NÃO está aqui (intencional)

- Workspace profundo de personagem (3 etapas com viewport 3D + árvore de exploração) → protótipo v1 (`/prototype-v1-personagem/`) já valida isso.
- Implementação real dos efeitos WebGL, captura de frames, escrita de `.aseprite`.
- Auth real (Logto), persistência server-side, GCS, geração real via IA.
- Validação rigorosa de formulários (protótipo aceita inputs vazios).

## O que olhar primeiro

1. Home — clica em um projeto.
2. Projeto — vê os assets, troca filtros, abre detalhe de um asset, clica "abrir editor".
3. Editor — explora os parâmetros, clica "republicar" (vai aparecer aviso de sobrescrita).
4. Volta no menu, abre Workbench → Vídeos. Vê todos os vídeos do usuário. Note os tags "publicado em ..." nos que viraram asset.
5. Clica em "+ criar vídeo" no header da workbench. Vê o seletor de fluxos.
6. Tenta o fluxo D: escolhe personagem, enquadramento, escreve prompt, clica gerar. Vai aparecer no editor.
7. No editor de um vídeo novo (sem publicação), clica "publicar como asset" e vê o seletor de projeto.
8. Reload — verifica que o estado persiste (localStorage).

## Limpar dados

Limpa do DevTools: Application → Local Storage → remova a chave `roto.proto.v2`. Reload pra reseed.
