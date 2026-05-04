# Personagem · Protótipo Navegável (v1 — preservado como referência)

> ⚠️ **Status: histórico, não atual.** Este protótipo foi feito antes da consolidação da visão mestra (`docs/visao-da-ferramenta.md`). Trata o módulo personagem como se fosse o produto inteiro — a visão atual o reposiciona como **um caminho (Fluxo D) dentro da ferramenta maior**.
>
> **Não apagar.** Aqui mora trabalho validado que será reaproveitado quando implementarmos o Fluxo D no produto real:
> - **Estética Atelier 2087** (`styles.css`) — sistema visual completo (dark, cobre, serif itálica). Reaproveitar.
> - **Viewport 3D** (`app.js`, seção Three.js) — carregamento FBX Mixamo, OrbitControls, 9 presets de câmera com animação ease-out, slider de FOV, readout em tempo real. Tudo funciona.
> - **Fluxo de geração em 3 etapas** (aparência → enquadramento → movimento) com hierarquia de prompt, custo previsto, modelo trocável — produto fechado, pronto pra implementar.
> - **Asset humanoide** (`assets/character.fbx`) — cópia local do Mixamo neutro.
>
> O protótipo v2 (em `prototype/`, quando existir) substitui este como referência de fluxo geral. Este aqui continua sendo a referência específica do Fluxo D.
>
> ⚠️ **NÃO copiar a arquitetura de UI deste protótipo para o v2.** A "home = lista de personagens" e "tela do personagem com 3 tabs" são adequadas pra um produto cujo escopo é só o módulo personagem — o produto real tem escopo maior (Galeria de projetos + Ateliê do usuário). Reaproveite **estética**, **componentes visuais**, **viewport 3D** e **fluxo das 3 etapas**. Não reaproveite a estrutura de navegação.

---

Protótipo de validação de produto do módulo **Personagem** do roto-master.
Não é implementação de produção — é um clickthrough de alta-fidelidade pra discutir o fluxo com o time.

## Como rodar

A página precisa de um servidor HTTP estático (por causa do FBX do humanoide e dos módulos ES). Abrir `index.html` direto via `file://` **funciona parcialmente**, mas a viewport 3D do diálogo de Enquadramento mostra um humanoide-de-fallback (primitivas) em vez do FBX real.

Recomendado:

```
cd prototype
npx serve .
# depois abre o link que ele imprime (http://localhost:3000 ou similar)
```

ou alternativa Python:

```
cd prototype
python -m http.server 8080
# abre http://localhost:8080
```

Tudo é vanilla JS + módulos ES via CDN (Three.js de jsdelivr). Sem build.

## O que está mockado / o que é interativo

### Interativo (funciona de verdade)
- Lista de personagens, criação de novo personagem (em memória).
- Renomear personagem (clicar no lápis ou no nome).
- Tabs Aparência / Enquadramento / Movimento dentro de um personagem.
- Selecionar uma aparência → filtra enquadramentos derivados (breadcrumb mostra a fonte).
- Selecionar um enquadramento → filtra movimentos derivados.
- Trocar a referência base via "pílula" no toolbar (abre source picker).
- Favoritar (★) e descartar nós; toggle "mostrar descartadas".
- Abrir os 3 diálogos de geração; preencher campos; ver prompt completo (constantes + estilo + texto livre).
- **Diálogo de Enquadramento (Etapa 2)** — viewport 3D real:
  - Carrega FBX Mixamo de `./assets/character.fbx` (cópia local do arquivo de `~/ved/random-experiments/skeleton-animation/assets/`).
  - 9 presets de câmera com animação suave (~600ms ease-out).
  - OrbitControls completo (orbit/pan/zoom).
  - Slider de FOV ao vivo.
  - Readout de posição/alvo da câmera atualizado em tempo real.
- "Gerar" simula loading e adiciona um card placeholder ao tab correspondente (imagem procedural SVG).
- Geração de movimento mostra badge "gerando" pulsante por 3s, depois resolve.

### Mockado / não implementado
- Todas as imagens são SVGs procedurais (assinaturas únicas por hash do id) — não há chamada real a IA.
- Vídeo de movimento é só um placeholder (ícone de play sobre uma imagem).
- "Rotoscopar" abre um toast informativo, não navega pro editor real.
- Salvar preset customizado não persiste (botão presente, ação não implementada).
- Persistência: nada vai pra disco. Reload zera tudo (mantém só os dados seed).
- Auth: header mostra `manu@did.lu` decorativo.

## Estrutura

```
prototype/
  index.html      shell + todas as telas e modais (display:none + body classes)
  styles.css      sistema completo (Atelier 2087 — dark, cobre, serif itálica)
  app.js          state, render, navegação, viewport Three.js
  README.md       este arquivo
```

## Sample data seedado

- **Cavaleiro Órfico (001)** — 3 aparências (v1 favorita), 2 enquadramentos derivados de v1 (lateral favorito), 2 movimentos derivados de "lateral v1" (andando favorito).
- **Bruxa Cinza (002)** — vazio, mostra empty states em todas as tabs.

## Mudança vs. doc original

A doc descrevia 3 colunas linear como workspace. Refinamento: **tabs independentes**. Cada tab é um workspace próprio onde o artista pode passar o dia explorando só aquela etapa. A conexão (Aparência → Enquadramento → Movimento) só importa no momento da geração e fica explícita no breadcrumb/pílula do toolbar.

## O que olhar primeiro pra validar

1. Abre na lista de personagens → clica no Cavaleiro.
2. Tab Aparência: vê 3 aparências; troca a seleção.
3. Tab Enquadramento: nota o breadcrumb "Derivando de: aparência v1 [trocar]".
4. Clica "+ gerar enquadramento" → **viewport 3D abre**. Testa os 9 presets, o slider de FOV, o orbit.
5. Volta, abre Tab Movimento, clica gerar → vê o card aparecer com badge "gerando" e resolver depois de 3s.
6. Volta pra lista, cria um personagem novo → vê os empty states.
