// Frames Editor — remocao de fundo via fal.ai (BiRefNet v2).
//
// Espelha fe-prompts.js: marca celula 'processando', chama fal, baixa PNG com
// alpha, sobe no GCS, versiona em fe_celula_versao (op_type='bg-remove'),
// atualiza fe_celula. Erros voltam estado pra idle com estado_erro.
//
// Decisoes:
//   - Modelo unico (BiRefNet v2) — sem dropdown no UI.
//   - PNG resultante mantem dimensoes do input; sem resize, so' troca a celula.
//   - Concorrencia conservadora (5) — birefnet eh GPU pesada, fila do fal pode
//     ficar lenta com muitos paralelos.

const crypto = require('crypto');
const fal = require('./providers/fal');
const { uploadBuffer } = require('./gcs');

const CONCURRENCY = 5;
const PRICE_USD_ESTIMATE = 0.01; // por celula

function gcsPathParaCelula(tirinhaId, celulaId) {
  const dia = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(3).toString('hex');
  return `frame-editor/tirinhas/${tirinhaId}/celulas/${celulaId}/${dia}-${hash}.png`;
}

async function processarCelula(pool, celulaId, opts = {}) {
  const { usarOriginal = false } = opts;
  const { rows } = await pool.query(
    `SELECT id, tirinha_id, png_url, png_url_original, largura, altura
       FROM fe_celula WHERE id = $1`,
    [celulaId]
  );
  if (!rows.length) return { ok: false, error: 'célula sumiu' };
  const cel = rows[0];

  try {
    // Se usarOriginal=true e a celula tem png_url_original, aplica em cima da
    // imagem que veio na importacao. Caso contrario, usa o estado atual.
    const fonteUrl = (usarOriginal && cel.png_url_original) ? cel.png_url_original : cel.png_url;
    if (!fonteUrl) throw new Error('célula sem imagem — nada pra remover fundo');

    // Chama BiRefNet via fal. Devolve URL de PNG com alpha.
    const result = await fal.removeBackground({ image_url: fonteUrl });

    // Baixa e sobe no nosso GCS (URL do fal expira).
    const upstream = await fetch(result.url);
    if (!upstream.ok) throw new Error(`fal output GET ${upstream.status}`);
    const buf = Buffer.from(await upstream.arrayBuffer());

    const dstPath = gcsPathParaCelula(cel.tirinha_id, cel.id);
    const stored = await uploadBuffer(dstPath, buf, 'image/png');

    // Versao anterior pro historico — undo volta a celula com o fundo.
    await pool.query(
      `INSERT INTO fe_celula_versao (celula_id, png_url, largura, altura, prompt, model_key, op_type, op_params)
       VALUES ($1, $2, $3, $4, NULL, $5, 'bg-remove', $6)`,
      [cel.id, cel.png_url, cel.largura, cel.altura, 'birefnet-v2', {}]
    );

    // Dimensoes ficam as mesmas; birefnet preserva tamanho.
    await pool.query(
      `UPDATE fe_celula
          SET png_url = $1,
              estado = 'idle',
              estado_erro = NULL,
              estado_atualizado_em = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [stored.gcs_url, cel.id]
    );

    await pool.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [cel.tirinha_id]);
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) ? e.message.slice(0, 500) : 'erro desconhecido';
    console.error(`fe-bg-remove celula ${celulaId}:`, msg);
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

async function processarLote(pool, celulasIds, opts = {}) {
  console.log(`[fe-bg-remove] lote ${celulasIds.length} celulas · concorrencia=${CONCURRENCY}${opts.usarOriginal ? ' · usar_original' : ''}`);
  const fila = [...celulasIds];
  const workers = Array.from({ length: Math.min(CONCURRENCY, fila.length) }, async () => {
    while (fila.length > 0) {
      const id = fila.shift();
      if (!id) break;
      await processarCelula(pool, id, opts);
    }
  });
  await Promise.allSettled(workers);
}

module.exports = {
  processarCelula,
  processarLote,
  PRICE_USD_ESTIMATE,
};
