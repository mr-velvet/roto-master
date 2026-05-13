// Frames Editor — processamento assíncrono de prompts de IA.
//
// Fluxo (espelha docs/frame-editor/ia.md §6):
//   1. Endpoint marca células alvo como `processando` em transação.
//   2. Devolve resposta rápida ao cliente.
//   3. Esta função roda em background: pra cada célula, baixa o PNG atual,
//      chama o provider (Fal.ai nano-banana-pro/edit), sobe o PNG novo no GCS,
//      atualiza fe_celula. Erros não abortam o lote — célula falhada volta
//      pra `idle` com `estado_erro` preenchido.
//
// Decisões MVP (ia.md §7-9):
//   - Sem retry, sem cancelamento, sem cache.
//   - Concorrência limitada por lote (CONCURRENCY) pra não pisar no rate limit.
//   - Provider Fal.ai nano-banana-pro/edit (acoplamento aceito; trocar = mudar
//     fal.generateImage por outro adapter).

const crypto = require('crypto');
const fal = require('./providers/fal');
const { uploadBuffer } = require('./gcs');
const { resizePngTo } = require('./png-resize');

const CONCURRENCY = 3;

// Catalogo de modelos disponiveis pra prompts em celula. Primeiro item e o
// default. Frontend pega via GET /api/fe/models e popula o dropdown.
const FE_PROMPT_MODELS = [
  {
    key: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    sub: 'Gemini 3 Pro Image',
    hint: 'qualidade alta, ~30s por celula',
  },
  {
    key: 'nano-banana',
    label: 'Nano Banana',
    sub: 'Gemini 2.5 Flash Image',
    hint: 'mais rapido e barato, ~10s por celula',
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    sub: 'OpenAI (abr/2026)',
    hint: 'estado da arte, ~1-3min por celula (depende da fila)',
  },
];
const FE_PROMPT_MODELS_BY_KEY = Object.fromEntries(FE_PROMPT_MODELS.map((m) => [m.key, m]));
const FE_PROMPT_DEFAULT_MODEL = FE_PROMPT_MODELS[0].key;

function resolverModelKey(modelKey) {
  if (modelKey && FE_PROMPT_MODELS_BY_KEY[modelKey]) return modelKey;
  return FE_PROMPT_DEFAULT_MODEL;
}

function gcsPathParaCelula(tirinhaId, celulaId) {
  const dia = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(3).toString('hex');
  return `frame-editor/tirinhas/${tirinhaId}/celulas/${celulaId}/${dia}-${hash}.png`;
}

// Processa uma única célula. Resolve com { ok, error? } sem rejeitar.
async function processarCelula(pool, celulaId, prompt, modelKey) {
  const modelo = resolverModelKey(modelKey);
  // Carrega estado atual da célula + dimensoes da tirinha (precisamos do
  // largura/altura da tirinha pra redimensionar a saida da IA — provider
  // gera 1024x1024, tirinha geralmente eh muito menor).
  const { rows } = await pool.query(
    `SELECT c.id, c.tirinha_id, c.png_url, c.largura AS prev_w, c.altura AS prev_h,
            t.largura AS tirinha_w, t.altura AS tirinha_h
       FROM fe_celula c
       JOIN fe_tirinha t ON t.id = c.tirinha_id
      WHERE c.id = $1`,
    [celulaId]
  );
  if (!rows.length) return { ok: false, error: 'célula sumiu' };
  const cel = rows[0];

  try {
    // Nano Banana (Pro ou Flash): prompt + ref_image_urls → PNG novo.
    // Célula vazia (png_url NULL) entra com refs vazia → modelo gera do nada.
    const refs = cel.png_url ? [cel.png_url] : [];
    const result = await fal.generateImage({
      prompt,
      ref_image_urls: refs,
      aspect_ratio: '1:1',
      resolution: '1K',
      model_key: modelo,
    });

    // Baixa, redimensiona pro tamanho da tirinha, sobe.
    const upstream = await fetch(result.url);
    if (!upstream.ok) throw new Error(`fal output GET ${upstream.status}`);
    const rawBuf = Buffer.from(await upstream.arrayBuffer());
    const { buffer: resized, width: w, height: h } = resizePngTo(rawBuf, cel.tirinha_w, cel.tirinha_h);

    const dstPath = gcsPathParaCelula(cel.tirinha_id, cel.id);
    const stored = await uploadBuffer(dstPath, resized, 'image/png');

    // Versao anterior vai pro historico ANTES de sobrescrever png_url. Isso
    // alimenta o undo (POST /api/fe/celulas/:id/undo). Mesmo celula vazia
    // (png_url NULL) eh registrada — undo dela volta pra vazia.
    await pool.query(
      `INSERT INTO fe_celula_versao (celula_id, png_url, largura, altura, prompt, model_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cel.id, cel.png_url, cel.prev_w, cel.prev_h, prompt, modelo]
    );

    // Atualiza célula: novo png_url, dimensoes da tirinha, estado idle.
    await pool.query(
      `UPDATE fe_celula
          SET png_url = $1,
              largura = $2,
              altura = $3,
              estado = 'idle',
              estado_erro = NULL,
              estado_atualizado_em = NOW(),
              updated_at = NOW()
        WHERE id = $4`,
      [stored.gcs_url, w || cel.tirinha_w, h || cel.tirinha_h, cel.id]
    );

    // Toca updated_at da tirinha.
    await pool.query(
      `UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`,
      [cel.tirinha_id]
    );
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) ? e.message.slice(0, 500) : 'erro desconhecido';
    console.error(`fe-prompt celula ${celulaId}:`, msg);
    // Célula volta a idle com erro; png_url permanece intacto (ia.md §8).
    await pool.query(
      `UPDATE fe_celula
          SET estado = 'idle',
              estado_erro = $1,
              estado_atualizado_em = NOW()
        WHERE id = $2`,
      [msg, celulaId]
    );
    return { ok: false, error: msg };
  }
}

// Processa N células em lote, com concorrência limitada.
// Não bloqueia o caller — chamada é fire-and-forget (rota dispara, retorna
// 202, e o processo segue rodando aqui em background).
async function processarLote(pool, celulasIds, prompt, modelKey) {
  // Lote simples: workers consumindo de uma fila in-memory.
  const fila = [...celulasIds];
  const workers = Array.from({ length: Math.min(CONCURRENCY, fila.length) }, async () => {
    while (fila.length > 0) {
      const id = fila.shift();
      if (!id) break;
      await processarCelula(pool, id, prompt, modelKey);
    }
  });
  await Promise.allSettled(workers);
}

module.exports = {
  processarLote,
  FE_PROMPT_MODELS,
  FE_PROMPT_MODELS_BY_KEY,
  FE_PROMPT_DEFAULT_MODEL,
};
