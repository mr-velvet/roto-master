# Frames Editor — visão macro

Última atualização: 2026-05-07 (revisão — pousa decisões fechadas em conversa que ainda não estavam em arquivo: tirinha como entidade própria no banco, edição online com estado vivo e colaborativa, MVP com matriz camadas×quadros e prompt como ação principal, distinção entre `.aseprite` original-da-quebra e final na importação de asset, três caminhos de saída sem vínculo vivo com asset.)

Este documento descreve o **Frames Editor** — uma das três áreas macro da ferramenta — em nível conceitual. É um espelho da `docs/visao-da-ferramenta.md` no recorte desta área. Se houver conflito entre os dois, vale a visão.

Detalhamento técnico (modelo de dados concreto, endpoints, padrão de storage, mecânica de IA, layout exato de UI) fica pra rodadas seguintes.

---

## 1. Onde fica

A ferramenta tem **três áreas macro**, irmãs no nível mais alto da navegação. O alternador no topo (header global) lista as três:

- **Assets** — projetos com seus assets entregáveis (o que hoje é a Galeria).
- **Frames Creator** — produção de quadros a partir de vídeo (renomeação do que hoje é o Ateliê).
- **Frames Editor** — edição de tirinhas. **Esta área.**

O Frames Editor **não é subseção** do Frames Creator nem dos Assets. É área macro irmã, acessada pelo alternador global.

## 2. O que é

Frames Editor é um **editor online** de tirinhas, com estado vivo no banco e colaboração entre quem tem o token. A função é permitir que parte do trabalho de quadro-a-quadro que historicamente só acontecia fora da ferramenta (no Aseprite desktop, na máquina do artista) também possa acontecer **dentro** da ferramenta.

Não é um editor stateless de arquivos `.aseprite`. É um editor com **suas próprias tirinhas**, persistidas, compartilhadas. O artista escolhe onde quer trabalhar a cada momento (Aseprite desktop, Frames Editor, ambos em ordens diferentes); a ferramenta não impõe um caminho único.

## 3. Princípio fundador — desacoplamento por arquivo, não por ausência de estado

O Frames Editor tem **suas próprias entidades no banco** — em particular, sua própria **tirinha**. Essa tirinha é entidade independente da tirinha do Frames Creator: tabelas separadas, ciclos de vida separados, modelos de dados podem evoluir separadamente.

O desacoplamento entre Frames Editor e o resto da ferramenta acontece **pela troca via arquivo `.aseprite`**, não pela ausência de estado interno:

- **Importação:** quando o Frames Editor recebe um `.aseprite` (upload manual ou via asset), ele **copia o conteúdo** pra dentro de uma tirinha sua. A tirinha resultante vive sozinha — não fica referenciando o asset de origem, não sincroniza, não sabe se o asset mudou depois.
- **Exportação:** quando o Frames Editor envia um `.aseprite` pra fora (download, ou publicação como novo asset), ele **gera o arquivo** e entrega. Quem recebe trata como qualquer `.aseprite`. Nenhum dos lados guarda referência ao outro.

Esse desacoplamento é deliberado:

- Permite o Frames Editor evoluir sem desestabilizar o resto.
- Permite o resto evoluir sem condicionar o Frames Editor.
- Reflete a realidade prática: o `.aseprite` é o formato comum trocado entre o artista no desktop, o Frames Editor, e a esteira de assets. Cada lugar trata o arquivo à sua maneira.
- Permite, no limite, que o Frames Editor seja substituído (ou complementado) por outro editor sem mexer no resto.

O que **não** desacopla:

- Frames Editor **tem estado** — tabela própria de tirinha, persistida no mesmo banco, visível e editável por qualquer pessoa com token. Sem isso não seria editor online; seria abrir-arquivo-fechar-arquivo, e nesse caso o Aseprite desktop já basta.

## 4. Como uma tirinha entra no Frames Editor

Tirinha do Frames Editor é criada explicitamente, com origem clara. Três caminhos:

1. **Criar nova tirinha vazia.** Começa do zero — útil quando o material vai ser construído inteiramente dentro do Frames Editor (cenário menos comum, mas possível).

2. **Subir arquivo `.aseprite` (upload manual).** O `.aseprite` pode ter qualquer origem — veio do artista, foi baixado de um asset, foi gerado em outra ferramenta. O Frames Editor não pergunta de onde veio. O conteúdo é importado pra uma tirinha nova.

3. **Importar de um asset.** Cada asset (na área Assets) tem ação **"editar como tirinha"** (ou equivalente). Essa ação cria uma tirinha nova no Frames Editor a partir de um `.aseprite` do asset, e leva o usuário pro editor já com a tirinha aberta. O asset pode disponibilizar mais de um `.aseprite` candidato:

   - **`.aseprite` original-da-quebra** — gerado pela ferramenta no momento da publicação do asset, com os quadros vindos da quebra do vídeo (camadas como referência ou como arte final, conforme configurado na publicação).
   - **`.aseprite` final** — versão trabalhada artisticamente (subida pelo artista após trabalho fora, ou produzida no próprio Frames Editor e publicada de volta).

   Quando o asset tem ambos, a ação "editar como tirinha" oferece a escolha. Quando só um existe, importa direto.

Em todos os casos, **a tirinha resultante é independente**. Não fica conectada ao asset, não recebe atualizações automáticas, não dispara mudanças no asset. É uma cópia consciente.

## 5. Como uma tirinha sai do Frames Editor

Três caminhos, todos explícitos:

1. **Salvar (guardar na própria tirinha).** O trabalho persiste no banco do Frames Editor, na própria entidade da tirinha. A tirinha continua viva, editável, colaborativa. Esse é o estado padrão de "ainda trabalhando".

2. **Download como `.aseprite`.** Gera o arquivo e entrega ao usuário. Pode levar pro Aseprite desktop, pra outra ferramenta, pra arquivar, ou pra subir manualmente em algum asset (na área Assets).

3. **Publicar como novo asset.** Gera o `.aseprite` e cria um asset novo na área Assets a partir dele. Funciona como "envia, cria do outro lado, e pronto" — **nenhum dos dois passa a referenciar o outro**. A tirinha continua existindo no Frames Editor; o asset existe independentemente. Se a tirinha mudar depois, o asset não muda. Se o asset mudar depois (por outro caminho), a tirinha não muda.

A regra geral: **a saída do Frames Editor pra fora dele é sempre via arquivo `.aseprite`** (download ou publicação como novo asset). O "salvar" é interno, mantém a tirinha viva dentro do Frames Editor mesmo.

Não existe "salvar de volta no asset original", "sincronizar com asset", ou qualquer tipo de vínculo vivo. Toda exportação é cópia consciente; quem recebe é um lado novo da história.

## 6. O editor da tirinha — escopo MVP

Cada tirinha aberta entra num editor com layout inspirado em editores de pixel-art tradicionais (Aseprite desktop como referência mental), mas com escopo bem mais enxuto.

**Tela 1 — Lista de tirinhas.** Ao abrir o Frames Editor, o usuário vê a lista das tirinhas existentes (da entidade do banco do Frames Editor). Cada tirinha mostra um thumb, nome, e ação principal "abrir". Botão "criar nova tirinha" abre o menu com as três origens descritas na seção 4.

**Tela 2 — Editor da tirinha.** Tem dois elementos centrais:

- **Canvas em cima** — mostra o quadro atualmente selecionado, com todas as camadas compostas. É a visualização principal.
- **Matriz camadas × quadros embaixo** — uma linha por camada, uma coluna por quadro. Cada célula mostra um thumb daquele quadro naquela camada. A matriz é a interface de navegação e seleção.

**Seleção:** o usuário pode selecionar célula única, coluna inteira (= um quadro, todas as camadas), linha inteira (= uma camada, todos os quadros), ou múltiplas células arbitrárias.

**Ações disponíveis no MVP:**

- **Prompt pra todos os quadros** (ação global, não depende de seleção). Aplica um prompt aberto sobre todos os quadros da tirinha.
- **Prompt pra quadros selecionados** (ação contextual, depende da seleção). Aplica um prompt aberto sobre o que estiver selecionado — um quadro só, um intervalo, uma camada inteira, etc.

A palavra **"prompt"** é deliberada. **Não** chamamos de "estilizar" — o user decide o que escrever no prompt (estilizar, limpar, mudar pose, ajustar cor, qualquer coisa). A ferramenta não enforça intenção.

**O que o MVP do editor não inclui (ficam pra depois):**

- **Edição manual de pixels (pintar com lápis, balde, borracha, etc.)** — fica fora do MVP. Quem precisa editar pixel-a-pixel baixa o `.aseprite` e mexe no Aseprite desktop. No futuro pode entrar, mas o objetivo nunca será replicar o Aseprite — só cobrir coisas que são chatas no desktop e ficam fáceis aqui.
- Versões coexistentes de um mesmo quadro (variantes alternativas comparáveis).
- Histórico de revisões granular.
- Undo/redo profundo entre sessões.
- Múltiplas tirinhas abertas em abas.

Cada um desses entra (ou não) numa rodada própria, no momento em que justificar.

## 7. Colaboração

Como toda a ferramenta, o Frames Editor obedece ao princípio "nada é do usuário": qualquer pessoa com o token vê todas as tirinhas e pode editar todas. Não há ownership, não há filtros "minhas tirinhas".

**Edição simultânea por mais de uma pessoa na mesma tirinha** é direção arquitetural aceita pra futuro, mas **não** é requisito do MVP. No MVP basta que duas pessoas em momentos diferentes possam pegar a mesma tirinha e continuar de onde a outra parou (estado persiste no banco, é isso). Conflitos de edição simultânea não-resolvidos aceitáveis no MVP.

## 8. O que fica fora do Frames Editor

Pra ficar inequívoco:

- **Obter vídeo, manipular vídeo, quebrar vídeo em quadros.** Tudo isso é Frames Creator.
- **Publicar trabalho como asset, organizar em projetos, decidir o que vai entrar no entregável.** Isso é Assets. (O Frames Editor pode disparar a criação de um asset novo via "publicar como novo asset", mas a vida do asset depois disso é da área Assets.)
- **Conhecimento sobre quem é o usuário, ownership.** Não existe na plataforma toda; aqui também não.

## 9. Identidade visual e UX

Decisão fora deste doc. A área é macro irmã das outras duas, então tem liberdade pra ter identidade visual própria — não precisa herdar paleta, densidade ou linguagem do Frames Creator e dos Assets. O trabalho dentro do Frames Editor é íntimo com pixel; UI provavelmente terá densidade visual e ritmo diferentes.

## 10. O que este documento não cobre (intencionalmente)

- Modelo de dados concreto da tirinha (colunas, formato dos quadros no banco, padrão de storage de imagens, indexação de camadas).
- Padrão real de armazenamento (GCS, banco, IndexedDB local, mistura).
- Endpoints, payloads, mecânica de cache de prompts.
- Integrações específicas de IA (modelos, parâmetros, custo por operação, worker assíncrono pra lote).
- UI detalhada (componentes, layout exato, atalhos de teclado, cursor states).
- Política de versionamento de tirinha (snapshots, undo entre sessões, history).
- Política concreta de colaboração simultânea (locking, CRDT, last-write-wins).
- Mecânica de "publicar como novo asset" (qual projeto recebe, nomeação automática, escolha de modo de exportação do `.aseprite`).
- Mecânica de "editar como tirinha" partindo do asset (qual `.aseprite` é oferecido quando o asset tem mais de um, UI de escolha).

Tudo isso é matéria das próximas rodadas de design e implementação do Frames Editor, a serem tocadas em conversas próprias com este documento como entrada.

## 11. Referências

- `docs/visao-da-ferramenta.md` — visão completa da ferramenta. O Frames Editor é uma das três áreas macro descritas lá.
- `PROGRESS.md` — estado vivo da implementação.
