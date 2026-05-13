// Cliente da API do Frames Editor. Endpoints sob /api/fe/.
// Espelha docs/frame-editor/api.md.

import { authedFetch } from './auth.js';

async function jsonOrThrow(r, ctx) {
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `${ctx}: ${r.status}`);
  }
  return r.json();
}

// === Tirinhas ===

export async function listTirinhas() {
  const r = await authedFetch('/api/fe/tirinhas');
  const data = await jsonOrThrow(r, 'list tirinhas');
  return data.tirinhas || [];
}

export async function getTirinha(id) {
  const r = await authedFetch(`/api/fe/tirinhas/${id}`);
  if (r.status === 404) return null;
  return jsonOrThrow(r, 'get tirinha');
}

// Cria tirinha vazia. Servidor monta 1 camada + 1 quadro + 1 célula vazia.
export async function createTirinhaVazia({ nome, largura, altura }) {
  const r = await authedFetch('/api/fe/tirinhas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem: 'vazia', nome, largura, altura }),
  });
  return jsonOrThrow(r, 'create tirinha (vazia)');
}

// Cria tirinha "asset" — variante 3 do api.md §3. Front passa estrutura ja
// parseada (igual variante 'upload') + origem_meta com asset_id e tipo.
// Servidor grava com origem='asset' pra cicatriz informativa.
export async function createTirinhaDeAsset({ nome, asset_id, tipo_aseprite, largura, altura, camadas, quadros, celulas }) {
  const r = await authedFetch('/api/fe/tirinhas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origem: 'asset',
      nome,
      origem_meta: { asset_id, tipo_aseprite: tipo_aseprite || 'final' },
      largura,
      altura,
      camadas,
      quadros,
      celulas,
    }),
  });
  return jsonOrThrow(r, 'create tirinha (asset)');
}

// Publica tirinha como asset novo. Pre-requisito: chamar uploadAseprite antes
// (pra que last_aseprite_url esteja gravada).
export async function publicarComoAsset({ tirinhaId, projectId, name }) {
  const r = await authedFetch(`/api/fe/tirinhas/${tirinhaId}/publicar-asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, name }),
  });
  return jsonOrThrow(r, 'publicar como asset');
}

// Cria tirinha de upload (após front parsear .aseprite e subir os PNGs).
// Recebe a estrutura final com URLs já resolvidas.
export async function createTirinhaUpload({ nome, origem_meta, largura, altura, camadas, quadros, celulas }) {
  const r = await authedFetch('/api/fe/tirinhas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origem: 'upload',
      nome,
      origem_meta,
      largura,
      altura,
      camadas,
      quadros,
      celulas,
    }),
  });
  return jsonOrThrow(r, 'create tirinha (upload)');
}

export async function patchTirinha(id, patch) {
  const r = await authedFetch(`/api/fe/tirinhas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow(r, 'patch tirinha');
}

export async function deleteTirinha(id) {
  const r = await authedFetch(`/api/fe/tirinhas/${id}`, { method: 'DELETE' });
  return jsonOrThrow(r, 'delete tirinha');
}

// === Camadas ===

export async function addCamada(tirinhaId, { nome, ordem, visivel } = {}) {
  const r = await authedFetch(`/api/fe/tirinhas/${tirinhaId}/camadas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, ordem, visivel }),
  });
  const data = await jsonOrThrow(r, 'add camada');
  return data.camada;
}

export async function patchCamada(id, patch) {
  const r = await authedFetch(`/api/fe/camadas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await jsonOrThrow(r, 'patch camada');
  return data.camada;
}

export async function deleteCamada(id) {
  const r = await authedFetch(`/api/fe/camadas/${id}`, { method: 'DELETE' });
  return jsonOrThrow(r, 'delete camada');
}

// === Quadros ===

export async function addQuadro(tirinhaId, { indice } = {}) {
  const r = await authedFetch(`/api/fe/tirinhas/${tirinhaId}/quadros`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indice }),
  });
  const data = await jsonOrThrow(r, 'add quadro');
  return data.quadro;
}

export async function deleteQuadro(id) {
  const r = await authedFetch(`/api/fe/quadros/${id}`, { method: 'DELETE' });
  return jsonOrThrow(r, 'delete quadro');
}

// === Células ===

// Sobe PNG (multipart). Recebe Blob/File ou Uint8Array (será envelopado em Blob).
export async function uploadPng({ tirinhaId, celulaId, blob, filename = 'cel.png' }) {
  const fd = new FormData();
  const fileBlob = blob instanceof Blob ? blob : new Blob([blob], { type: 'image/png' });
  fd.append('file', fileBlob, filename);
  if (tirinhaId) fd.append('tirinha_id', tirinhaId);
  if (celulaId) fd.append('celula_id', celulaId);
  const r = await authedFetch('/api/fe/upload-png', { method: 'POST', body: fd });
  return jsonOrThrow(r, 'upload-png');
}

export async function patchCelula(id, { png_url, largura, altura }) {
  const body = { png_url };
  if (png_url) {
    if (Number.isFinite(largura)) body.largura = largura;
    if (Number.isFinite(altura)) body.altura = altura;
  }
  const r = await authedFetch(`/api/fe/celulas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await jsonOrThrow(r, 'patch celula');
  return data.celula;
}

// Upload de imagem de referencia de estilo (PNG/JPG/WebP). Devolve { url }.
// Sem vinculo a tirinha/celula — eh global, pra reusar entre prompts.
export async function uploadStyleRef({ blob, filename = 'style-ref' }) {
  const fd = new FormData();
  const fileBlob = blob instanceof Blob ? blob : new Blob([blob]);
  fd.append('file', fileBlob, filename);
  const r = await authedFetch('/api/fe/upload-style-ref', { method: 'POST', body: fd });
  return jsonOrThrow(r, 'upload style ref');
}

// === Aseprite (export) ===

export async function uploadAseprite({ tirinhaId, blob, filename = 'tirinha.aseprite' }) {
  const fd = new FormData();
  const fileBlob = blob instanceof Blob ? blob : new Blob([blob], { type: 'application/octet-stream' });
  fd.append('file', fileBlob, filename);
  fd.append('tirinha_id', tirinhaId);
  const r = await authedFetch('/api/fe/upload-aseprite', { method: 'POST', body: fd });
  return jsonOrThrow(r, 'upload-aseprite');
}

// === Prompts (IA) ===
//
// Endpoint pode ainda não existir na worktree atual (está sendo escrito em
// paralelo). Front trata 404 como "back ainda não tem o endpoint" e mostra
// mensagem amigável.
export async function dispararPrompt({ tirinhaId, prompt, celulasIds, modelKey, usarOriginal, autoAdaptRatio, bgRemoveAfter, styleRefUrl }) {
  const body = { tirinha_id: tirinhaId, prompt, celulas_ids: celulasIds };
  if (modelKey) body.model_key = modelKey;
  if (usarOriginal) body.usar_original = true;
  if (autoAdaptRatio) body.auto_adapt_ratio = true;
  if (bgRemoveAfter) body.bg_remove_after = true;
  if (styleRefUrl) body.style_ref_url = styleRefUrl;
  const r = await authedFetch('/api/fe/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 404) {
    throw new Error('endpoint de prompt ainda não disponível no servidor');
  }
  return jsonOrThrow(r, 'disparar prompt');
}

// Catalogo de modelos pra prompts em celula.
export async function listFeModels() {
  const r = await authedFetch('/api/fe/models');
  return jsonOrThrow(r, 'listar modelos');
}

// Catalogo de operacoes de edicao local (dither/adjust) + paletas.
export async function listFeEditOps() {
  const r = await authedFetch('/api/fe/edits/ops');
  return jsonOrThrow(r, 'listar operacoes de edicao');
}

// Dispara edicao local em N celulas. opType: 'dither' | 'adjust'.
export async function dispararEdicao({ tirinhaId, celulasIds, opType, opParams, usarOriginal }) {
  const body = {
    tirinha_id: tirinhaId,
    celulas_ids: celulasIds,
    op_type: opType,
    op_params: opParams || {},
  };
  if (usarOriginal) body.usar_original = true;
  const r = await authedFetch('/api/fe/edits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 404) throw new Error('endpoint de edicao ainda nao disponivel');
  return jsonOrThrow(r, 'disparar edicao');
}

// Remove fundo das celulas via fal.ai BiRefNet v2. Marca processando, retorna
// {job_id, celulas_marcadas, price_usd_estimate} em 202. Usa polling normal.
// Celulas vazias (sem png_url) sao filtradas pelo backend silenciosamente.
export async function removerBackground({ tirinhaId, celulasIds, usarOriginal = false }) {
  const body = { tirinha_id: tirinhaId, celulas_ids: celulasIds };
  if (usarOriginal) body.usar_original = true;
  const r = await authedFetch('/api/fe/bg-remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 404) throw new Error('endpoint de bg-remove ainda nao disponivel');
  return jsonOrThrow(r, 'remover background');
}

// Single-step undo de uma celula: backend pop a versao mais recente e
// devolve a celula atualizada. 404 se nao ha historico.
export async function undoCelula(celulaId) {
  const r = await authedFetch(`/api/fe/celulas/${celulaId}/undo`, { method: 'POST' });
  if (r.status === 404) return null;
  return jsonOrThrow(r, 'desfazer celula');
}

// Limpa avisos de erro (estado_erro) de todas celulas da tirinha.
export async function clearTirinhaErrors(tirinhaId) {
  const r = await authedFetch(`/api/fe/tirinhas/${tirinhaId}/clear-errors`, { method: 'POST' });
  return jsonOrThrow(r, 'limpar avisos');
}

// Pra UI: descobre que ratio o modelo realmente vai usar dado (w, h) da tirinha.
// Resp: { model_key, target_w, target_h, ratio_label, ratio_value, exato }.
export async function planejarRatio(modelKey, w, h) {
  const r = await authedFetch(`/api/fe/models/${encodeURIComponent(modelKey)}/plan-ratio?w=${w}&h=${h}`);
  return jsonOrThrow(r, 'planejar ratio');
}
