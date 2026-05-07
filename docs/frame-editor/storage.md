# Frames Editor — storage

Última atualização: 2026-05-07 (criação)

Onde os arquivos do Frames Editor vivem fisicamente, como são nomeados, e como são limpados. Escopo MVP.

Pré-requisitos: `docs/frame-editor/visao.md`, `docs/frame-editor/modelo-de-dados.md`.

---

## 1. Princípio

Banco guarda referência, **storage guarda arquivo**. O Frames Editor produz dois tipos de arquivo:

- **PNGs de células** — uma imagem por linha de `fe_celula`, gerada por parsing de `.aseprite` na importação ou por prompt de IA na edição.
- **Arquivos `.aseprite`** — gerados na exportação (download ou publicação como novo asset). Pode haver `.aseprite` transitório também (importação descompactada vs serializada — ver `aseprite-io.md`).

Tudo vai pro **GCS**, no mesmo bucket que a plataforma já usa: `didlu-imagestore`. Servido via `https://st.did.lu/<path>`.

Não há storage local, IndexedDB, ou banco como backend de imagem. Frames Editor é online — o estado vive no banco + GCS, acessível por qualquer pessoa com token.

## 2. Nomenclatura

Padrão de path no bucket:

```
frame-editor/
  tirinhas/
    <tirinha_id>/
      celulas/
        <celula_id>/
          <yyyy-mm-dd>-<hash6>.png
      aseprite/
        <yyyy-mm-dd>-<hash6>.aseprite
```

- `<tirinha_id>` — UUID da tirinha. Dá pasta inteira por tirinha, facilita inspeção e futura varredura.
- `<celula_id>` — UUID da célula. Cada célula tem sua subpasta — substituições acumulam fisicamente no GCS sem regra ativa de remoção no MVP (ver §6).
- `<yyyy-mm-dd>-<hash6>` — data + 6 hex aleatórios. Garante URL nova a cada upload (cache-busting), mantém legibilidade humana, evita colisão.

**Decisão crítica do padrão:** cada upload gera **arquivo novo com nome novo**. Nunca sobrescrever path existente. O cache do CDN é agressivo — reusar URL gera bug visual quase inevitável. O ciclo é: sobe arquivo novo → atualiza `png_url`/etc no banco → arquivo antigo deixa de ser referenciado (fica no bucket sem regra ativa de remoção no MVP — ver §6).

## 3. URLs

Ao gravar `png_url` em `fe_celula`, gravar a forma curta:

```
https://st.did.lu/frame-editor/tirinhas/<tirinha_id>/celulas/<celula_id>/<yyyy-mm-dd>-<hash6>.png
```

Nunca a forma longa `storage.googleapis.com/didlu-imagestore/...`. Convenção da plataforma (CLAUDE.md global do user).

## 4. Tipos de arquivo, vida útil

### 4.1 PNG de célula

- **Quando nasce:** importação de `.aseprite` (parser sobe um PNG por interseção camada×quadro), criação manual de camada/quadro vazio que depois recebe conteúdo, edição por prompt (IA gera, sobe PNG novo).
- **Vida:** referência única em `fe_celula.png_url`. Quando a célula é regenerada, `png_url` aponta pro novo, antigo vira órfão.
- **Tamanho típico esperado:** quadros de pixel-art são pequenos (kilobytes). Mesmo tirinhas grandes (8 camadas × 60 quadros = 480 PNGs) ficam baixo de 50MB total. Sem preocupação de custo no MVP.

### 4.2 `.aseprite` exportado

- **Quando nasce:** geração **on-demand**, no momento em que o user pede. Sem job de fundo, sem regeneração periódica, sem antecipação. O `.aseprite` da tirinha **não existe** até alguém clicar pra exportar.
- **Quem pede:**
  - **Download:** user clica em "download" no editor. Servidor gera o `.aseprite` a partir do estado atual da tirinha, sobe pro GCS, devolve URL pro front, front dispara download.
  - **Publicar como novo asset:** servidor gera o `.aseprite`, e a área Assets recebe o arquivo (ou a URL) pra criar o asset novo do lado dela.
- **Vida:** mantém **só o último gerado por tirinha**. Cada nova exportação substitui o anterior (path novo pra cache-busting; coluna no banco — ou simples "último arquivo na pasta da tirinha" — aponta pro vigente). Botão "baixar último" no editor pega o que estiver lá (e gera se ainda não houver).
- **Sem regeneração proativa:** se a tirinha mudou desde o último download, o `.aseprite` guardado está desatualizado. O user clica em "download", gera de novo, substitui o último. É barato gerar.

## 5. Acesso e permissões

Bucket `didlu-imagestore` é público — qualquer URL `st.did.lu/...` é acessível sem auth. Isso vale pra todo o Frames Editor: PNGs e `.aseprite` exportados são acessíveis publicamente por URL.

Implicação: se um PNG sensível foi gerado e o user quer "esconder", apagar do GCS é o único caminho — não há ACL granular. No MVP isto não é preocupação (conteúdo é arte de jogo, não dado pessoal).

## 6. O que não está aqui

- **Mecânica de upload do servidor pro GCS** (autenticação, biblioteca, tratamento de erro) → matéria de implementação, fora do escopo do doc conceitual.
- **Cache-control / headers HTTP** → herda padrão da plataforma.
- **Backup/restore** → herda padrão da plataforma. Tirinha apagada = irrecuperável no MVP.
- **Quotas e limites** → não imposto no MVP. Se virar problema, entra em rodada própria.
- **Edição offline / cache local** → não existe. Frames Editor é online, sempre.
- **Varredura/limpeza de PNGs órfãos e `.aseprite` antigos no GCS** → fora do MVP. PNGs antigos de células regeneradas e `.aseprite` substituídos ficam no bucket sem regra ativa de remoção. Quando o volume virar ruído real, decisão entra em rodada própria — agora seria complexidade prematura que confunde o modelo.
