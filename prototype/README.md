# roto-master · protótipo navegável v2

Validação da visão da ferramenta (`docs/visao-da-ferramenta.md`) — **metáfora Galeria/Ateliê**.

## Como rodar

Servidor estático qualquer:

```
cd prototype
python -m http.server 8763
# abre http://localhost:8763
```

ou:

```
npx serve .
```

Vanilla JS + módulos ES. Sem build. Sem deps.

## O que valida

**Foco principal:** a transição entre os dois espaços (Galeria e Ateliê) é legível, não arbitrária.

A diferença visual é deliberada — paleta, densidade, tipografia, "cheiro" de cada lugar:

- **Galeria** — tom frio, ink puro, identidade de museu/sala expositiva. Espaçada. Cards de projeto + cards de asset com peso visual.
- **Ateliê** — tom quente (cobre nas laterais e na sidebar), faixa cobre como assinatura no header, sensação de bancada de trabalho. Sidebar lateral com as 4 subseções.
- **Header** muda de cor entre os dois espaços. Rótulo grande "você está em: Galeria/Ateliê" reforça onde o usuário está.
- **Alternador binário** Galeria↔Ateliê no canto direito é o único controle de troca (cumpre 6.3 da visão).
- **Transição animada (~500ms)** ao trocar de espaço — overlay com label do destino + "entrando…". Equivalente visual a "abrir uma porta", não loading.

## Telas implementadas

1. **Galeria · Home** — lista de projetos. Botão "novo projeto" fora do grid (sem card de "+ novo").
2. **Galeria · Detalhe do projeto** — cards de asset com preview, status como tag, vínculo com vídeo-fonte. **Sem botão "+ novo asset"** — chamada redigida explicando que asset nasce ao publicar.
3. **Ateliê · Vídeos** (default) — grid de vídeos com selo de origem (upload/url/genérico/personagem) + selo de publicação ("publicado em X" ou "rascunho").
4. **Ateliê · Personagens / Enquadramentos / Câmeras** — listas próprias, sem subnavegação que repita "workbench".
5. **Editor** — tela cheia, breadcrumb persistente, sidebar direita com publish como ato deliberado.
6. **Modais** — novo projeto, seletor de fluxo A/B/C/D (B/C com selo "em breve"), publicar como asset (com aviso de sobrescrita).

## Anti-padrões evitados (da seção 6.5 da visão)

- ✓ Sem botão "workbench" em headers contextuais.
- ✓ Sem dropdown "Workbench" abrindo as 4 subseções como peers.
- ✓ Sem botão "+ novo asset" no detalhe do projeto.
- ✓ Sem card de "+ novo projeto" no grid.
- ✓ Sem atalho pra criar vídeo na home global.
- ✓ Sem header SaaS genérico — chrome reflete a metáfora.
- ✓ Asset não é checkbox — é card com peso visual.
- ✓ Workbench tem identidade de bancada criativa, não de settings panel.

## Mockado

Tudo via localStorage. Nenhuma chamada real à IA. Tipo de origem do vídeo é só decorativo nos selos. Botões de criar personagem/enquadramento/câmera mostram toast informativo.

Reset dos dados seed: botão "↺ resetar" no banner do topo.

## Não reaproveitado (mas planejado pra produção)

- Estética **Atelier 2087** (paleta cobre/serif itálica) reaproveitada do `prototype-v1-personagem/`.
- Viewport 3D do Fluxo D (Three.js + FBX Mixamo + presets de câmera) — não está aqui, mas mora preservado em `prototype-v1-personagem/`.
