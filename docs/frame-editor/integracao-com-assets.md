# Frames Editor — integração com Assets

Última atualização: 2026-05-07 (criação)

Define os pontos de contato entre o Frames Editor e a área Assets. Este é o **único** doc da pasta `docs/frame-editor/` que toca outra área da ferramenta.

Pré-requisitos: `visao.md` (especialmente §3, §4, §5), `api.md` §3 e §9.

---

## 1. Princípio

Frames Editor e Assets são **áreas macro irmãs e desacopladas** (`visao.md` §3). Cada uma tem suas próprias entidades, seu próprio ciclo de vida, sua própria UI. A ponte entre as duas é **o arquivo `.aseprite`**, e nada mais.

Esse princípio é estrutural, não cosmético: nenhuma das duas áreas guarda referência viva à outra. Asset não sabe que existe tirinha vinda dele; tirinha não sabe (de forma viva) qual asset ela originou. Ambas são entidades soberanas, que trocam apenas o arquivo no momento da troca.

A "cicatriz informativa" `origem_meta` em `fe_tirinha` (`modelo-de-dados.md` §2.1) é exceção pragmática — registra de onde a tirinha veio na criação, mas é texto, não FK. Asset original pode ser apagado; tirinha continua viva sem se importar. Tirinha pode ser apagada; asset continua vivo sem saber.

## 2. Pontos de contato (apenas dois)

Existem **dois** pontos de contato, e só dois:

1. **Asset → Frames Editor**: ação "Editar como tirinha" no card do asset cria uma tirinha nova no Frames Editor a partir do `.aseprite` do asset.
2. **Frames Editor → Asset**: ação "Publicar como novo asset" no editor da tirinha cria um asset novo na área Assets a partir do `.aseprite` da tirinha.

Não há terceiro ponto. Não há "atualizar asset com mudanças da tirinha". Não há "sincronizar". Não há "asset puxa última versão da tirinha". Cada nova publicação é **asset novo**.

## 3. Fluxo 1 — Asset → Frames Editor

### 3.1 Onde

Botão "**Editar como tirinha**" no card do asset (na UI da área Assets). Pode aparecer também em outros lugares onde o asset é mostrado (detalhe, lista expandida), mas o card é o ponto óbvio.

### 3.2 O que o asset oferece

Um asset pode ter zero, um ou dois `.aseprite`s candidatos pra abertura no Frames Editor:

- **`original-da-quebra`** — `.aseprite` gerado pela ferramenta no momento em que o asset foi publicado a partir do Frames Creator. Carrega os quadros como vieram da quebra do vídeo (referência ou arte final, conforme configurado na publicação).
- **`final`** — `.aseprite` que representa a versão trabalhada artisticamente. Pode ter sido subido pelo artista após trabalho fora, ou pode ter sido publicado no asset a partir do próprio Frames Editor (caso comum: a tirinha do Frames Editor publicou um asset com seu `.aseprite` final).

Asset com nenhum dos dois → botão "Editar como tirinha" não aparece.
Asset com um só → o botão usa esse direto, sem perguntar.
Asset com os dois → o botão pergunta qual abrir (modal custom — não diálogo nativo).

A área Assets é responsável por saber quais `.aseprite`s ela tem pra cada asset. O Frames Editor só pergunta "me dá a URL do `.aseprite` X do asset Y" e segue.

### 3.3 Como o Frames Editor consome

O front do Frames Editor recebe a URL do `.aseprite` (cliente vai direto, sem proxy do servidor — bucket é público, conforme `storage.md` §5). Daí em diante, é o caminho normal de criação por upload (`api.md` §3 variante 3 → variante 2):

1. Front baixa o `.aseprite` da URL.
2. Front parseia (`aseprite-io.md` §2).
3. Front sobe os PNGs das células (`api.md` §6).
4. Front finaliza criação chamando `POST /api/fe/tirinhas` com `origem: "asset"` e `origem_meta: { asset_id, tipo_aseprite }`.
5. Servidor cria as entidades em transação. Devolve a tirinha pronta.
6. Front leva o user direto pro editor da tirinha recém-criada (Tela 2).

A criação é **cópia consciente** — não há vínculo vivo, conforme §1. Tirinha tem PNGs próprios, no path do Frames Editor. Asset original mantém seus arquivos intocados.

### 3.4 Mudanças posteriores no asset

Se o asset for editado depois (por outro caminho — por exemplo, alguém republica o asset com `.aseprite` novo na área Assets), a tirinha do Frames Editor **não muda**. Ela é um snapshot do momento da importação. Pra trabalhar sobre a versão nova do asset, o user faz "Editar como tirinha" de novo, criando uma tirinha nova.

## 4. Fluxo 2 — Frames Editor → Asset

### 4.1 Onde

Botão "**Publicar como novo asset**" no topo do editor da tirinha (Tela 2 do Frames Editor — `ui.md` §4.7).

### 4.2 O que o Frames Editor oferece

O `.aseprite` resultante do estado atual da tirinha. Geração on-demand no front (`aseprite-io.md` §3), upload via `POST /api/fe/upload-aseprite` (`api.md` §9), URL do GCS resultante.

Frames Editor **não escolhe modo** de exportação (`aseprite-io.md` §3.3) — exporta fiel ao estado.

### 4.3 Como Assets recebe

A área Assets expõe um endpoint de criação de asset que aceita `.aseprite` como entrada. O Frames Editor chama (via `POST /api/fe/tirinhas/:id/publicar-asset`, que internamente fala com a área Assets):

- Passa a URL do `.aseprite`.
- Passa metadados que a área Assets exige (projeto, nome, etc.) — payload exato é responsabilidade da área Assets, este doc não congela.

A área Assets:
1. Recebe.
2. Cria o asset com aquele `.aseprite` (provavelmente como "final", já que vem trabalhado — mas a regra é da área Assets, não do Frames Editor).
3. Devolve `asset_id` do recém-criado.

### 4.4 Sem vínculo

Crucial: **nenhum vínculo é criado**. A tirinha não passa a "apontar" pro asset. O asset não passa a "apontar" pra tirinha. Cada um vive independente.

Implicações:

- Editar a tirinha depois **não atualiza** o asset.
- Editar o asset depois (por outro caminho) **não atualiza** a tirinha.
- Apagar a tirinha **não apaga** o asset.
- Apagar o asset **não apaga** a tirinha.
- Publicar a mesma tirinha duas vezes cria **dois assets distintos**, cada um com seu `.aseprite` no momento da publicação.

O `asset_id` retornado é informativo (UI confirma "asset criado, abrir?"), não é guardado em `fe_tirinha`.

### 4.5 Tirinha permanece

Após a publicação, a tirinha continua existindo no Frames Editor, no estado em que foi publicada. User pode continuar editando — alterações futuras não afetam o asset que foi criado, pelo princípio §4.4. Pra refletir mudanças no lado dos assets, é necessário publicar de novo (gerando outro asset).

## 5. O que não existe (por desacoplamento)

Anti-padrões de integração que **não** devem ser implementados:

- **"Sincronizar tirinha com asset"** — botão que atualiza asset com estado atual da tirinha. Quebraria desacoplamento.
- **"Tirinha conectada a asset"** com indicador visual de "fora de sincronia". Pressuporia vínculo vivo.
- **"Editar asset diretamente do Frames Editor"** sem criar tirinha intermediária. Quebraria a regra de cópia consciente.
- **"Última versão" / "histórico de publicações"** vinculando asset a múltiplas tirinhas-de-origem. Asset é asset; sua vida é dele.
- **Tirinha automaticamente criada quando asset é criado em outra parte da plataforma**. Tirinha nasce só por ação explícita.
- **Notificação na tirinha quando o asset de origem muda.** Tirinha não escuta o asset.

Cada um desses parece útil isoladamente, mas todos quebrariam o princípio §1. O custo arquitetural de manter vínculo vivo (sincronização, conflito, ordem de operações entre áreas) é desproporcional ao benefício pra esta ferramenta.

## 6. O que esta integração custa pra cada lado

**Pra Assets:**
- Expor URL do `.aseprite` `original-da-quebra` e/ou `final` por asset, quando existirem.
- Aceitar criação de asset novo via `.aseprite` + metadados.
- Botão "Editar como tirinha" no card.
- Saber quais `.aseprite`s tem disponível (informação que Assets já carrega — não é responsabilidade nova).

**Pra Frames Editor:**
- Ler `.aseprite` de URL externa (já é o caminho de upload genérico).
- Endpoint `publicar-asset` que orquestra a chamada à área Assets.
- Botão "Publicar como novo asset" na Tela 2.

Custo de cada lado é mínimo. Nenhum dos dois precisa conhecer entidades internas do outro.

## 7. Implementação concreta

Este doc define o contrato conceitual. Interfaces concretas (caminhos de URL, payload exato pra criação de asset, biblioteca de chamada interna entre áreas) são responsabilidade da rodada de implementação, dos dois lados, conjuntamente.

Recomenda-se que a interface seja documentada explicitamente em `docs/integracoes/frame-editor-assets.md` (ou similar) quando entrar implementação — pra que ambas as áreas tenham referência única do contrato HTTP/interno. Este doc da pasta `frame-editor/` cobre só o lado conceitual visto do Frames Editor.

## 8. O que não está aqui

- Schema/payload exato dos endpoints da área Assets (responsabilidade da área Assets, não do Frames Editor).
- UI da área Assets (botão "Editar como tirinha", modal de escolha de `.aseprite`) — concept aqui, mas detalhamento visual fica com a área Assets.
- Mecânica de criação do asset a partir do `.aseprite` (qual projeto, qual nome default, validação) — regra da área Assets.
- Caminho reverso (asset que muda → notifica tirinhas-de-origem) — não existe, por desacoplamento.
