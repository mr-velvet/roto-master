// Frames Editor — endpoints REST sob /api/fe/*.
// Espelha docs/frame-editor/api.md §3-6 (escopo MVP).
//
// Convenções:
// - Auth via APP_TOKEN (middleware requireUser).
// - Sem owner_*, sem ACL — qualquer pessoa com token vê/edita tudo.
// - URLs de PNG/aseprite na forma curta https://st.did.lu/...
// - IDs são UUID. Erros: { error: "msg" } + status HTTP.
// - Endpoint de prompt (ia.md §6) e live updates (api.md §8) ficam em rodada propria.

const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { uploadBuffer, PUBLIC_URL_PREFIX } = require('../lib/gcs');
const { processarLote } = require('../lib/fe-prompts');

const router = Router();

// PNGs de célula raramente passam de 1MB; tirinha grande pode subir muitos.
// .aseprite exportado pode ser maior (cobre 50MB tranquilo). 100MB de margem.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ============================================================
// Helpers
// ============================================================

const TIRINHA_COLS = `id, nome, largura, altura, origem, origem_meta,
                       last_aseprite_url, created_at, updated_at`;
const CAMADA_COLS = `id, tirinha_id, nome, ordem, visivel, created_at`;
const QUADRO_COLS = `id, tirinha_id, indice, created_at`;
const CELULA_COLS = `id, tirinha_id, camada_id, quadro_id, png_url, largura, altura,
                     estado, estado_erro, estado_atualizado_em, updated_at`;

function gcsPathParaPng(tirinhaId, celulaId) {
  const dia = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(3).toString('hex');
  return `frame-editor/tirinhas/${tirinhaId}/celulas/${celulaId || '_pending'}/${dia}-${hash}.png`;
}

function gcsPathParaAseprite(tirinhaId) {
  const dia = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(3).toString('hex');
  return `frame-editor/tirinhas/${tirinhaId}/aseprite/${dia}-${hash}.aseprite`;
}

function tratarErroId(e, res) {
  if (e && e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
  return null;
}

// ============================================================
// Tirinhas
// ============================================================

// GET /api/fe/tirinhas — lista (sem filtro). Thumb = primeiro PNG não-NULL.
router.get('/tirinhas', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT t.id, t.nome, t.largura, t.altura, t.created_at, t.updated_at,
              (SELECT c.png_url
                 FROM fe_celula c
                 JOIN fe_camada cam ON cam.id = c.camada_id
                 JOIN fe_quadro q   ON q.id = c.quadro_id
                WHERE c.tirinha_id = t.id
                  AND c.png_url IS NOT NULL
                  AND cam.visivel = TRUE
                ORDER BY q.indice ASC, cam.ordem DESC
                LIMIT 1) AS thumb_url
         FROM fe_tirinha t
        ORDER BY t.updated_at DESC`
    );
    res.json({ tirinhas: rows });
  } catch (e) {
    console.error('list tirinhas:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

// POST /api/fe/tirinhas — cria (3 variantes por origem).
//
// Variante 1 — vazia: { origem: "vazia", nome, largura, altura }
//   Cria tirinha + 1 camada inicial ("camada 1") + 1 quadro inicial + 1 célula vazia.
//
// Variante 2 — upload: cliente já parseou o .aseprite no front e subiu os PNGs
//   das células (POST /api/fe/upload-png). Agora finaliza: { origem: "upload",
//   nome, largura, altura, origem_meta?, camadas: [{nome,ordem,visivel}],
//   quadros: [{indice}], celulas: [{camada_indice, quadro_indice, png_url?, largura?, altura?}] }
//   Cria tudo em transação. Cardinalidade célula = C × Q (vazias entram com png_url NULL).
//
// Variante 3 — asset: igual variante 2 mas origem="asset" e origem_meta carrega
//   { asset_id, tipo_aseprite }. Front baixa o .aseprite do asset e segue caminho da v2.
router.post('/tirinhas', requireUser, async (req, res) => {
  const origem = req.body?.origem;
  const nome = (req.body?.nome || '').trim() || 'Tirinha sem título';
  const largura = parseInt(req.body?.largura, 10);
  const altura = parseInt(req.body?.altura, 10);

  if (!['vazia', 'upload', 'asset'].includes(origem)) {
    return res.status(400).json({ error: "origem deve ser 'vazia' | 'upload' | 'asset'" });
  }
  if (!Number.isFinite(largura) || largura < 1 || largura > 4096) {
    return res.status(400).json({ error: 'largura inválida (1-4096)' });
  }
  if (!Number.isFinite(altura) || altura < 1 || altura > 4096) {
    return res.status(400).json({ error: 'altura inválida (1-4096)' });
  }
  const origemMeta = req.body?.origem_meta || null;

  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [tirinha] } = await client.query(
      `INSERT INTO fe_tirinha (nome, largura, altura, origem, origem_meta)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${TIRINHA_COLS}`,
      [nome, largura, altura, origem, origemMeta]
    );

    let camadas = [];
    let quadros = [];
    let celulas = [];

    if (origem === 'vazia') {
      const { rows: [cam] } = await client.query(
        `INSERT INTO fe_camada (tirinha_id, nome, ordem, visivel)
         VALUES ($1, 'camada 1', 0, TRUE) RETURNING ${CAMADA_COLS}`,
        [tirinha.id]
      );
      const { rows: [qd] } = await client.query(
        `INSERT INTO fe_quadro (tirinha_id, indice) VALUES ($1, 0) RETURNING ${QUADRO_COLS}`,
        [tirinha.id]
      );
      const { rows: [cel] } = await client.query(
        `INSERT INTO fe_celula (tirinha_id, camada_id, quadro_id) VALUES ($1, $2, $3)
         RETURNING ${CELULA_COLS}`,
        [tirinha.id, cam.id, qd.id]
      );
      camadas = [cam]; quadros = [qd]; celulas = [cel];
    } else {
      // upload | asset: cliente envia C, Q, C×Q.
      const camadasIn = Array.isArray(req.body?.camadas) ? req.body.camadas : [];
      const quadrosIn = Array.isArray(req.body?.quadros) ? req.body.quadros : [];
      const celulasIn = Array.isArray(req.body?.celulas) ? req.body.celulas : [];

      if (camadasIn.length < 1 || camadasIn.length > 64) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'camadas: 1-64' });
      }
      if (quadrosIn.length < 1 || quadrosIn.length > 1024) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'quadros: 1-1024' });
      }

      // Insere camadas preservando ordem.
      const camadasIds = [];
      for (let i = 0; i < camadasIn.length; i++) {
        const c = camadasIn[i];
        const camNome = (c?.nome || '').trim() || `camada ${i + 1}`;
        const camOrdem = Number.isFinite(c?.ordem) ? c.ordem : i;
        const camVis = c?.visivel !== false;
        const { rows: [novaCam] } = await client.query(
          `INSERT INTO fe_camada (tirinha_id, nome, ordem, visivel)
           VALUES ($1, $2, $3, $4) RETURNING ${CAMADA_COLS}`,
          [tirinha.id, camNome, camOrdem, camVis]
        );
        camadasIds.push(novaCam.id);
        camadas.push(novaCam);
      }

      // Insere quadros.
      const quadrosIds = [];
      for (let i = 0; i < quadrosIn.length; i++) {
        const q = quadrosIn[i];
        const qIdx = Number.isFinite(q?.indice) ? q.indice : i;
        const { rows: [novoQ] } = await client.query(
          `INSERT INTO fe_quadro (tirinha_id, indice) VALUES ($1, $2) RETURNING ${QUADRO_COLS}`,
          [tirinha.id, qIdx]
        );
        quadrosIds.push(novoQ.id);
        quadros.push(novoQ);
      }

      // Insere células: a entrada do cliente vem indexada por (camada_indice, quadro_indice)
      // referindo posição na lista enviada (zero-based). Convertemos pra IDs reais.
      // Garantimos cardinalidade C × Q: toda interseção precisa virar linha,
      // mesmo as não enviadas pelo cliente (entram vazias).
      const matriz = new Map(); // "ci:qi" → { png_url, largura, altura }
      for (const cel of celulasIn) {
        const ci = Number.isFinite(cel?.camada_indice) ? cel.camada_indice : -1;
        const qi = Number.isFinite(cel?.quadro_indice) ? cel.quadro_indice : -1;
        if (ci < 0 || ci >= camadasIds.length || qi < 0 || qi >= quadrosIds.length) continue;
        matriz.set(`${ci}:${qi}`, {
          png_url: cel?.png_url || null,
          largura: Number.isFinite(cel?.largura) ? cel.largura : null,
          altura: Number.isFinite(cel?.altura) ? cel.altura : null,
        });
      }
      for (let ci = 0; ci < camadasIds.length; ci++) {
        for (let qi = 0; qi < quadrosIds.length; qi++) {
          const dados = matriz.get(`${ci}:${qi}`) || { png_url: null, largura: null, altura: null };
          const { rows: [novaCel] } = await client.query(
            `INSERT INTO fe_celula (tirinha_id, camada_id, quadro_id, png_url, largura, altura)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CELULA_COLS}`,
            [tirinha.id, camadasIds[ci], quadrosIds[qi], dados.png_url, dados.largura, dados.altura]
          );
          celulas.push(novaCel);
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: tirinha.id, tirinha: { ...tirinha, camadas, quadros, celulas } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create tirinha:', e);
    res.status(500).json({ error: 'create failed' });
  } finally {
    client.release();
  }
});

// GET /api/fe/tirinhas/:id — estado completo.
router.get('/tirinhas/:id', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { rows: [t] } = await pool.query(
      `SELECT ${TIRINHA_COLS} FROM fe_tirinha WHERE id = $1`,
      [req.params.id]
    );
    if (!t) return res.status(404).json({ error: 'não encontrada' });

    const [{ rows: camadas }, { rows: quadros }, { rows: celulas }] = await Promise.all([
      pool.query(`SELECT ${CAMADA_COLS} FROM fe_camada WHERE tirinha_id = $1 ORDER BY ordem ASC`, [t.id]),
      pool.query(`SELECT ${QUADRO_COLS} FROM fe_quadro WHERE tirinha_id = $1 ORDER BY indice ASC`, [t.id]),
      pool.query(`SELECT ${CELULA_COLS} FROM fe_celula WHERE tirinha_id = $1`, [t.id]),
    ]);

    res.json({ ...t, camadas, quadros, celulas });
  } catch (e) {
    if (tratarErroId(e, res)) return;
    console.error('get tirinha:', e);
    res.status(500).json({ error: 'get failed' });
  }
});

// PATCH /api/fe/tirinhas/:id — só nome no MVP.
router.patch('/tirinhas/:id', requireUser, async (req, res) => {
  const updates = [];
  const params = [];
  let i = 1;
  if (typeof req.body?.nome === 'string') {
    const n = req.body.nome.trim();
    if (!n || n.length > 200) return res.status(400).json({ error: 'nome inválido' });
    updates.push(`nome = $${i++}`); params.push(n);
  }
  if (typeof req.body?.last_aseprite_url === 'string') {
    // Atualizado via /upload-aseprite normalmente, mas aceita patch direto.
    updates.push(`last_aseprite_url = $${i++}`); params.push(req.body.last_aseprite_url);
  }
  if (!updates.length) return res.status(400).json({ error: 'nada pra atualizar' });
  updates.push(`updated_at = NOW()`);
  params.push(req.params.id);

  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE fe_tirinha SET ${updates.join(', ')} WHERE id = $${i} RETURNING ${TIRINHA_COLS}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrada' });
    res.json({ tirinha: rows[0] });
  } catch (e) {
    if (tratarErroId(e, res)) return;
    console.error('patch tirinha:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

// DELETE /api/fe/tirinhas/:id — cascade no banco. PNGs ficam órfãos no GCS (storage.md §6).
router.delete('/tirinhas/:id', requireUser, async (req, res) => {
  try {
    const { rowCount } = await req.app.locals.pool.query(
      `DELETE FROM fe_tirinha WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'não encontrada' });
    res.json({ ok: true });
  } catch (e) {
    if (tratarErroId(e, res)) return;
    console.error('delete tirinha:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ============================================================
// Camadas
// ============================================================

// POST /api/fe/tirinhas/:id/camadas — adiciona. Cria células vazias cruzando com todos os quadros.
router.post('/tirinhas/:id/camadas', requireUser, async (req, res) => {
  const tirinhaId = req.params.id;
  const nome = (req.body?.nome || '').trim() || 'camada';
  const visivel = req.body?.visivel !== false;
  const ordemPedida = Number.isFinite(req.body?.ordem) ? req.body.ordem : null;

  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Confirma que a tirinha existe.
    const { rows: [t] } = await client.query(`SELECT id FROM fe_tirinha WHERE id = $1`, [tirinhaId]);
    if (!t) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'tirinha não encontrada' });
    }

    let ordem;
    if (ordemPedida === null) {
      const { rows: [agg] } = await client.query(
        `SELECT COALESCE(MAX(ordem), -1) AS max_ord FROM fe_camada WHERE tirinha_id = $1`,
        [tirinhaId]
      );
      ordem = agg.max_ord + 1;
    } else {
      ordem = ordemPedida;
      // Empurra ordens >= pedida pra abrir espaço.
      await client.query(
        `UPDATE fe_camada SET ordem = ordem + 1 WHERE tirinha_id = $1 AND ordem >= $2`,
        [tirinhaId, ordem]
      );
    }

    const { rows: [novaCam] } = await client.query(
      `INSERT INTO fe_camada (tirinha_id, nome, ordem, visivel)
       VALUES ($1, $2, $3, $4) RETURNING ${CAMADA_COLS}`,
      [tirinhaId, nome, ordem, visivel]
    );

    // Cria células vazias pra cruzar com todos os quadros.
    const { rows: quadros } = await client.query(
      `SELECT id FROM fe_quadro WHERE tirinha_id = $1`, [tirinhaId]
    );
    for (const q of quadros) {
      await client.query(
        `INSERT INTO fe_celula (tirinha_id, camada_id, quadro_id) VALUES ($1, $2, $3)`,
        [tirinhaId, novaCam.id, q.id]
      );
    }

    await client.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [tirinhaId]);
    await client.query('COMMIT');
    res.status(201).json({ camada: novaCam });
  } catch (e) {
    await client.query('ROLLBACK');
    if (tratarErroId(e, res)) return;
    console.error('create camada:', e);
    res.status(500).json({ error: 'create failed' });
  } finally {
    client.release();
  }
});

// PATCH /api/fe/camadas/:id — nome, visivel, ordem.
// Reordenação fica em transação que ajusta as outras camadas afetadas.
router.patch('/camadas/:id', requireUser, async (req, res) => {
  const camadaId = req.params.id;
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [atual] } = await client.query(
      `SELECT ${CAMADA_COLS} FROM fe_camada WHERE id = $1`, [camadaId]
    );
    if (!atual) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'não encontrada' });
    }

    const updates = [];
    const params = [];
    let i = 1;

    if (typeof req.body?.nome === 'string') {
      const n = req.body.nome.trim();
      if (!n || n.length > 100) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'nome inválido' });
      }
      updates.push(`nome = $${i++}`); params.push(n);
    }
    if (typeof req.body?.visivel === 'boolean') {
      updates.push(`visivel = $${i++}`); params.push(req.body.visivel);
    }

    // Reordenação: troca ordem com a camada que ocupa o destino.
    // Solução simples (não perfeita): move pra slot temporário (-1), atualiza
    // a outra ocupando o lugar, e finaliza. Evita conflito com UNIQUE(tirinha_id, ordem).
    if (Number.isFinite(req.body?.ordem) && req.body.ordem !== atual.ordem) {
      const novaOrdem = req.body.ordem;
      // Slot temporário negativo único — usa -id pra evitar colisão entre concorrentes.
      const tempOrdem = -Math.abs(parseInt(camadaId.replace(/\D/g, '').slice(0, 6), 10) || 1);
      await client.query(`UPDATE fe_camada SET ordem = $1 WHERE id = $2`, [tempOrdem, camadaId]);
      // Reorganiza as outras: se subindo (novaOrdem > atual.ordem), as do meio descem 1.
      // Se descendo (novaOrdem < atual.ordem), as do meio sobem 1.
      if (novaOrdem > atual.ordem) {
        await client.query(
          `UPDATE fe_camada SET ordem = ordem - 1
           WHERE tirinha_id = $1 AND ordem > $2 AND ordem <= $3`,
          [atual.tirinha_id, atual.ordem, novaOrdem]
        );
      } else {
        await client.query(
          `UPDATE fe_camada SET ordem = ordem + 1
           WHERE tirinha_id = $1 AND ordem >= $2 AND ordem < $3`,
          [atual.tirinha_id, novaOrdem, atual.ordem]
        );
      }
      updates.push(`ordem = $${i++}`); params.push(novaOrdem);
    }

    if (!updates.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'nada pra atualizar' });
    }

    params.push(camadaId);
    const { rows } = await client.query(
      `UPDATE fe_camada SET ${updates.join(', ')} WHERE id = $${i} RETURNING ${CAMADA_COLS}`,
      params
    );
    await client.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [atual.tirinha_id]);
    await client.query('COMMIT');
    res.json({ camada: rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (tratarErroId(e, res)) return;
    console.error('patch camada:', e);
    res.status(500).json({ error: 'patch failed' });
  } finally {
    client.release();
  }
});

// DELETE /api/fe/camadas/:id — cascade nas células daquela camada.
router.delete('/camadas/:id', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    // Captura tirinha_id antes pra atualizar updated_at.
    const { rows: [cam] } = await pool.query(
      `SELECT tirinha_id FROM fe_camada WHERE id = $1`, [req.params.id]
    );
    if (!cam) return res.status(404).json({ error: 'não encontrada' });
    await pool.query(`DELETE FROM fe_camada WHERE id = $1`, [req.params.id]);
    await pool.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [cam.tirinha_id]);
    res.json({ ok: true });
  } catch (e) {
    if (tratarErroId(e, res)) return;
    console.error('delete camada:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ============================================================
// Quadros
// ============================================================

// POST /api/fe/tirinhas/:id/quadros — adiciona. Cria células vazias cruzando com todas as camadas.
router.post('/tirinhas/:id/quadros', requireUser, async (req, res) => {
  const tirinhaId = req.params.id;
  const indicePedido = Number.isFinite(req.body?.indice) ? req.body.indice : null;

  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [t] } = await client.query(`SELECT id FROM fe_tirinha WHERE id = $1`, [tirinhaId]);
    if (!t) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'tirinha não encontrada' });
    }

    let indice;
    if (indicePedido === null) {
      const { rows: [agg] } = await client.query(
        `SELECT COALESCE(MAX(indice), -1) AS max_idx FROM fe_quadro WHERE tirinha_id = $1`,
        [tirinhaId]
      );
      indice = agg.max_idx + 1;
    } else {
      indice = indicePedido;
      await client.query(
        `UPDATE fe_quadro SET indice = indice + 1 WHERE tirinha_id = $1 AND indice >= $2`,
        [tirinhaId, indice]
      );
    }

    const { rows: [novoQ] } = await client.query(
      `INSERT INTO fe_quadro (tirinha_id, indice) VALUES ($1, $2) RETURNING ${QUADRO_COLS}`,
      [tirinhaId, indice]
    );

    // Cria células vazias cruzando com todas as camadas.
    const { rows: camadas } = await client.query(
      `SELECT id FROM fe_camada WHERE tirinha_id = $1`, [tirinhaId]
    );
    for (const c of camadas) {
      await client.query(
        `INSERT INTO fe_celula (tirinha_id, camada_id, quadro_id) VALUES ($1, $2, $3)`,
        [tirinhaId, c.id, novoQ.id]
      );
    }

    await client.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [tirinhaId]);
    await client.query('COMMIT');
    res.status(201).json({ quadro: novoQ });
  } catch (e) {
    await client.query('ROLLBACK');
    if (tratarErroId(e, res)) return;
    console.error('create quadro:', e);
    res.status(500).json({ error: 'create failed' });
  } finally {
    client.release();
  }
});

// DELETE /api/fe/quadros/:id — cascade + reindexa subsequentes.
router.delete('/quadros/:id', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [q] } = await client.query(
      `SELECT tirinha_id, indice FROM fe_quadro WHERE id = $1`, [req.params.id]
    );
    if (!q) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'não encontrado' });
    }

    await client.query(`DELETE FROM fe_quadro WHERE id = $1`, [req.params.id]);
    await client.query(
      `UPDATE fe_quadro SET indice = indice - 1 WHERE tirinha_id = $1 AND indice > $2`,
      [q.tirinha_id, q.indice]
    );
    await client.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [q.tirinha_id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (tratarErroId(e, res)) return;
    console.error('delete quadro:', e);
    res.status(500).json({ error: 'delete failed' });
  } finally {
    client.release();
  }
});

// ============================================================
// Células
// ============================================================

// POST /api/fe/upload-png — upload de PNG pra storage. Independente de célula.
// Multipart: file (PNG), tirinha_id, celula_id (opcional).
router.post('/upload-png', requireUser, upload.single('file'), async (req, res) => {
  const tirinhaId = (req.body?.tirinha_id || '').trim();
  const celulaId = (req.body?.celula_id || '').trim() || null;
  if (!tirinhaId) return res.status(400).json({ error: 'tirinha_id obrigatório' });
  if (!req.file) return res.status(400).json({ error: 'file obrigatório (multipart)' });

  // Validação leve do conteúdo: PNG começa com 89 50 4E 47 0D 0A 1A 0A.
  const buf = req.file.buffer;
  if (buf.length < 8 ||
      buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
    return res.status(400).json({ error: 'arquivo não é um PNG válido' });
  }

  // Largura/altura do PNG ficam no IHDR chunk (offset 16-23, big-endian).
  const largura = buf.readUInt32BE(16);
  const altura = buf.readUInt32BE(20);

  try {
    const path = gcsPathParaPng(tirinhaId, celulaId);
    const { gcs_url } = await uploadBuffer(path, buf, 'image/png');
    res.json({ png_url: gcs_url, largura, altura });
  } catch (e) {
    console.error('upload-png:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

// POST /api/fe/upload-aseprite — upload de .aseprite gerado pelo front.
// Multipart: file (.aseprite), tirinha_id.
// Atualiza last_aseprite_url da tirinha (storage.md §4.2 — só o último é mantido em referência).
router.post('/upload-aseprite', requireUser, upload.single('file'), async (req, res) => {
  const tirinhaId = (req.body?.tirinha_id || '').trim();
  if (!tirinhaId) return res.status(400).json({ error: 'tirinha_id obrigatório' });
  if (!req.file) return res.status(400).json({ error: 'file obrigatório' });

  try {
    const path = gcsPathParaAseprite(tirinhaId);
    const { gcs_url } = await uploadBuffer(path, req.file.buffer, 'application/octet-stream');
    await req.app.locals.pool.query(
      `UPDATE fe_tirinha SET last_aseprite_url = $1, updated_at = NOW() WHERE id = $2`,
      [gcs_url, tirinhaId]
    );
    res.json({ aseprite_url: gcs_url });
  } catch (e) {
    if (tratarErroId(e, res)) return;
    console.error('upload-aseprite:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

// PATCH /api/fe/celulas/:id — atualiza png_url (ou esvazia).
router.patch('/celulas/:id', requireUser, async (req, res) => {
  const celulaId = req.params.id;
  const body = req.body || {};
  const tem_png = Object.prototype.hasOwnProperty.call(body, 'png_url');
  if (!tem_png) return res.status(400).json({ error: 'png_url obrigatório (string ou null)' });

  const png_url = body.png_url;
  const largura = png_url ? (Number.isFinite(body.largura) ? body.largura : null) : null;
  const altura = png_url ? (Number.isFinite(body.altura) ? body.altura : null) : null;

  if (png_url !== null && typeof png_url !== 'string') {
    return res.status(400).json({ error: 'png_url deve ser string ou null' });
  }

  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE fe_celula
          SET png_url = $1, largura = $2, altura = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING ${CELULA_COLS}`,
      [png_url, largura, altura, celulaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrada' });
    // Atualiza updated_at da tirinha pai.
    await req.app.locals.pool.query(
      `UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`,
      [rows[0].tirinha_id]
    );
    res.json({ celula: rows[0] });
  } catch (e) {
    if (tratarErroId(e, res)) return;
    console.error('patch celula:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

// ============================================================
// Prompt (IA) — assíncrono desde o MVP (ia.md §1)
// ============================================================

// POST /api/fe/prompts — dispara prompt sobre uma ou mais células.
// Body: { tirinha_id, prompt, celulas_ids: [uuid, ...] }
// Resp: { job_id, celulas_marcadas } (HTTP 202)
//
// Comportamento:
//   1. Em transação, marca células como `processando` (rejeitando as que já
//      estão `processando` — ia.md §5: "rejeitar duplicata silenciosamente").
//   2. Devolve 202 imediatamente.
//   3. Processa em background via lib/fe-prompts.processarLote.
//
// Sem retry, sem cancelamento, sem cache (ia.md §7-9). Coerência entre
// quadros vizinhos é responsabilidade do user e do modelo, não da arquitetura.
router.post('/prompts', requireUser, async (req, res) => {
  const tirinhaId = (req.body?.tirinha_id || '').trim();
  const prompt = (req.body?.prompt || '').trim();
  const celulasIds = Array.isArray(req.body?.celulas_ids) ? req.body.celulas_ids : [];

  if (!tirinhaId) return res.status(400).json({ error: 'tirinha_id obrigatório' });
  if (!prompt) return res.status(400).json({ error: 'prompt obrigatório' });
  if (prompt.length > 4000) return res.status(400).json({ error: 'prompt muito longo (máx 4000)' });
  if (!celulasIds.length) return res.status(400).json({ error: 'celulas_ids obrigatório' });
  if (celulasIds.length > 500) return res.status(400).json({ error: 'lote muito grande (máx 500)' });

  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Marca como processando só as que estão idle e pertencem à tirinha pedida.
    // O `RETURNING id` traz a lista efetivamente marcada (filtra ids inválidos
    // ou já processando — silencioso, conforme ia.md §5).
    const { rows: marcadas } = await client.query(
      `UPDATE fe_celula
          SET estado = 'processando',
              estado_erro = NULL,
              estado_atualizado_em = NOW()
        WHERE id = ANY($1::uuid[])
          AND tirinha_id = $2
          AND estado = 'idle'
        RETURNING id`,
      [celulasIds, tirinhaId]
    );

    await client.query('COMMIT');

    const idsMarcados = marcadas.map((r) => r.id);
    const jobId = crypto.randomUUID();

    // Fire-and-forget: dispara o processamento sem esperar.
    if (idsMarcados.length > 0) {
      processarLote(pool, idsMarcados, prompt).catch((e) => {
        console.error('fe-prompts lote', jobId, 'falhou:', e);
      });
    }

    res.status(202).json({
      job_id: jobId,
      celulas_marcadas: idsMarcados,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    if (tratarErroId(e, res)) return;
    console.error('post prompts:', e);
    res.status(500).json({ error: 'falha ao disparar prompt' });
  } finally {
    client.release();
  }
});

module.exports = router;
