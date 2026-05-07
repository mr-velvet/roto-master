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
const { uploadFromUrl } = require('./gcs');

const CONCURRENCY = 3;

function gcsPathParaCelula(tirinhaId, celulaId) {
  const dia = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(3).toString('hex');
  return `frame-editor/tirinhas/${tirinhaId}/celulas/${celulaId}/${dia}-${hash}.png`;
}

// Processa uma única célula. Resolve com { ok, error? } sem rejeitar.
async function processarCelula(pool, celulaId, prompt) {
  // Carrega estado atual da célula (png_url pra mandar ao provider).
  const { rows } = await pool.query(
    `SELECT id, tirinha_id, png_url FROM fe_celula WHERE id = $1`,
    [celulaId]
  );
  if (!rows.length) return { ok: false, error: 'célula sumiu' };
  const cel = rows[0];

  try {
    // Fal nano-banana-pro/edit: prompt + ref_image_urls → PNG novo.
    // Célula vazia (png_url NULL) entra com refs vazia → fal gera do nada.
    const refs = cel.png_url ? [cel.png_url] : [];
    const result = await fal.generateImage({
      prompt,
      ref_image_urls: refs,
      aspect_ratio: '1:1',
      resolution: '1K',
    });

    // Sobe o resultado no GCS no path padrão da célula.
    const dstPath = gcsPathParaCelula(cel.tirinha_id, cel.id);
    const stored = await uploadFromUrl(result.url, dstPath, result.content_type || 'image/png');

    // Atualiza célula: novo png_url, estado idle, sem erro.
    // largura/altura ficam NULL aqui (provider não devolve) — front pode
    // reler e atualizar via PATCH se precisar; pro canvas read-only isto
    // não é crítico já que o PNG real é decodificado no browser.
    await pool.query(
      `UPDATE fe_celula
          SET png_url = $1,
              largura = NULL,
              altura = NULL,
              estado = 'idle',
              estado_erro = NULL,
              estado_atualizado_em = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [stored.gcs_url, cel.id]
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
async function processarLote(pool, celulasIds, prompt) {
  // Lote simples: workers consumindo de uma fila in-memory.
  const fila = [...celulasIds];
  const workers = Array.from({ length: Math.min(CONCURRENCY, fila.length) }, async () => {
    while (fila.length > 0) {
      const id = fila.shift();
      if (!id) break;
      await processarCelula(pool, id, prompt);
    }
  });
  await Promise.allSettled(workers);
}

module.exports = { processarLote };
