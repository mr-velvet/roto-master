// Frames Editor — modal de edicao local (dither / ajustes).
//
// Espelha a UX do modal de prompt: alvos resolvidos pelo caller, checkbox
// 'aplicar sobre imagem original', preview de N celulas. Sem custo (eh local).
//
// Roteia pra /api/fe/edits que reusa a maquinaria assincrona dos prompts:
// celula -> processando, polling atualiza estado, Ctrl+Z desfaz, tecla O
// mostra original.

import { openModal, closeModal, showToast } from './modals.js';
import { dispararEdicao, listFeEditOps } from './fe_api.js';

let opsCatalog = [];
let palettesCatalog = [];
let opSelecionada = 'dither';
let paletaSelecionada = 'bw';
let algoSelecionado = 'floyd-steinberg';
let alvosAtuais = [];   // celulas_ids
let onConfirmCb = null; // callback pra refresh do editor apos disparo

export function initFeEdits({ onConfirm } = {}) {
  if (onConfirm) onConfirmCb = onConfirm;
  listFeEditOps().then((data) => {
    opsCatalog = data.ops || [];
    palettesCatalog = data.palettes || [];
    if (!opsCatalog.find((o) => o.key === opSelecionada)) {
      opSelecionada = opsCatalog[0]?.key || 'dither';
    }
  }).catch((e) => console.warn('listFeEditOps falhou:', e));
}

export function abrirModalEdits({ ids, contexto = null }) {
  if (!ids || !ids.length) {
    showToast('selecione celulas pra editar');
    return;
  }
  alvosAtuais = [...ids];
  const m = document.querySelector('[data-modal="fe-edits"]');
  const $target = m.querySelector('[data-bind="fe-edits-target"]');
  const $err = m.querySelector('[data-bind="fe-edits-err"]');
  const $title = m.querySelector('[data-bind="fe-edits-title"]');
  $err.textContent = '';
  $title.textContent = ids.length === 1 ? 'Editar celula' : 'Editar celulas';
  $target.textContent = contexto || `vai aplicar em ${ids.length} celula${ids.length === 1 ? '' : 's'}`;
  popularOpSelect();
  popularPaletaSelect();
  refreshParams();
  openModal('fe-edits');
}

function popularOpSelect() {
  const $label = document.querySelector('[data-bind="fe-edits-op-label"]');
  const $menu = document.querySelector('[data-bind="fe-edits-op-menu"]');
  const $hint = document.querySelector('[data-bind="fe-edits-op-hint"]');
  if (!$label || !$menu) return;
  $menu.innerHTML = '';
  for (const o of opsCatalog) {
    const li = document.createElement('li');
    li.className = 'custom-select-item';
    li.dataset.opKey = o.key;
    li.innerHTML = `<span>${escapeHtml(o.label)}</span><span class="fe-prompt-model-sub">${escapeHtml(o.sub || '')}</span>`;
    $menu.appendChild(li);
  }
  const atual = opsCatalog.find((o) => o.key === opSelecionada);
  if (atual) {
    $label.textContent = atual.label;
    if ($hint) $hint.textContent = atual.hint || '';
  }
}

function popularPaletaSelect() {
  const $label = document.querySelector('[data-bind="fe-edits-paleta-label"]');
  const $menu = document.querySelector('[data-bind="fe-edits-paleta-menu"]');
  if (!$label || !$menu) return;
  $menu.innerHTML = '';
  for (const p of palettesCatalog) {
    const li = document.createElement('li');
    li.className = 'custom-select-item';
    li.dataset.paletaKey = p.key;
    li.innerHTML = `<span>${escapeHtml(p.label)}</span>`;
    $menu.appendChild(li);
  }
  if (!palettesCatalog.find((p) => p.key === paletaSelecionada)) {
    paletaSelecionada = palettesCatalog[0]?.key || 'bw';
  }
  const atual = palettesCatalog.find((p) => p.key === paletaSelecionada);
  if (atual) $label.textContent = atual.label;
  // niveis_ajustaveis controla visibilidade do slider de niveis
  const $niveisWrap = document.querySelector('[data-bind="fe-edits-niveis-wrap"]');
  const $niveis = document.querySelector('[data-bind="fe-edits-niveis"]');
  if ($niveisWrap && atual) {
    if (atual.niveis_ajustaveis) {
      $niveisWrap.removeAttribute('hidden');
      if ($niveis && atual.niveis_default && !$niveis.dataset.touched) {
        $niveis.value = atual.niveis_default;
        const $val = document.querySelector('[data-bind="fe-edits-niveis-val"]');
        if ($val) $val.textContent = atual.niveis_default;
      }
    } else {
      $niveisWrap.setAttribute('hidden', '');
    }
  }
}

function refreshParams() {
  const $dither = document.querySelector('[data-bind="fe-edits-params-dither"]');
  const $adjust = document.querySelector('[data-bind="fe-edits-params-adjust"]');
  if (opSelecionada === 'dither') {
    $dither.removeAttribute('hidden');
    $adjust.setAttribute('hidden', '');
  } else if (opSelecionada === 'adjust') {
    $dither.setAttribute('hidden', '');
    $adjust.removeAttribute('hidden');
  }
}

// ====== Eventos ======

// Dropdown OP
document.addEventListener('click', (e) => {
  const $sel = document.querySelector('[data-bind="fe-edits-op-select"]');
  const $menu = document.querySelector('[data-bind="fe-edits-op-menu"]');
  if (!$sel || !$menu) return;
  const toggleBtn = e.target.closest('[data-action="fe-edits-toggle-op-select"]');
  if (toggleBtn && $sel.contains(toggleBtn)) {
    const wasOpen = $sel.classList.contains('is-open');
    $sel.classList.toggle('is-open');
    if (wasOpen) $menu.setAttribute('hidden', '');
    else $menu.removeAttribute('hidden');
    return;
  }
  const item = e.target.closest('[data-bind="fe-edits-op-menu"] .custom-select-item');
  if (item) {
    opSelecionada = item.dataset.opKey;
    const o = opsCatalog.find((x) => x.key === opSelecionada);
    const $label = document.querySelector('[data-bind="fe-edits-op-label"]');
    const $hint = document.querySelector('[data-bind="fe-edits-op-hint"]');
    if ($label && o) $label.textContent = o.label;
    if ($hint) $hint.textContent = (o && o.hint) || '';
    $sel.classList.remove('is-open');
    $menu.setAttribute('hidden', '');
    refreshParams();
    return;
  }
  if (!$sel.contains(e.target)) {
    $sel.classList.remove('is-open');
    $menu.setAttribute('hidden', '');
  }
});

// Dropdown ALGO (dither)
document.addEventListener('click', (e) => {
  const $sel = document.querySelector('[data-bind="fe-edits-algo-select"]');
  const $menu = document.querySelector('[data-bind="fe-edits-algo-menu"]');
  if (!$sel || !$menu) return;
  const toggleBtn = e.target.closest('[data-action="fe-edits-toggle-algo-select"]');
  if (toggleBtn && $sel.contains(toggleBtn)) {
    const wasOpen = $sel.classList.contains('is-open');
    $sel.classList.toggle('is-open');
    if (wasOpen) $menu.setAttribute('hidden', '');
    else $menu.removeAttribute('hidden');
    return;
  }
  const item = e.target.closest('[data-bind="fe-edits-algo-menu"] .custom-select-item');
  if (item) {
    algoSelecionado = item.dataset.algo;
    const $label = document.querySelector('[data-bind="fe-edits-algo-label"]');
    if ($label) $label.textContent = item.querySelector('span').textContent;
    $sel.classList.remove('is-open');
    $menu.setAttribute('hidden', '');
    return;
  }
  if (!$sel.contains(e.target)) {
    $sel.classList.remove('is-open');
    $menu.setAttribute('hidden', '');
  }
});

// Dropdown PALETA
document.addEventListener('click', (e) => {
  const $sel = document.querySelector('[data-bind="fe-edits-paleta-select"]');
  const $menu = document.querySelector('[data-bind="fe-edits-paleta-menu"]');
  if (!$sel || !$menu) return;
  const toggleBtn = e.target.closest('[data-action="fe-edits-toggle-paleta-select"]');
  if (toggleBtn && $sel.contains(toggleBtn)) {
    const wasOpen = $sel.classList.contains('is-open');
    $sel.classList.toggle('is-open');
    if (wasOpen) $menu.setAttribute('hidden', '');
    else $menu.removeAttribute('hidden');
    return;
  }
  const item = e.target.closest('[data-bind="fe-edits-paleta-menu"] .custom-select-item');
  if (item) {
    paletaSelecionada = item.dataset.paletaKey;
    const $label = document.querySelector('[data-bind="fe-edits-paleta-label"]');
    const p = palettesCatalog.find((x) => x.key === paletaSelecionada);
    if ($label && p) $label.textContent = p.label;
    $sel.classList.remove('is-open');
    $menu.setAttribute('hidden', '');
    // mostra/esconde slider de niveis
    const $niveisWrap = document.querySelector('[data-bind="fe-edits-niveis-wrap"]');
    if ($niveisWrap) {
      if (p?.niveis_ajustaveis) $niveisWrap.removeAttribute('hidden');
      else $niveisWrap.setAttribute('hidden', '');
    }
    return;
  }
  if (!$sel.contains(e.target)) {
    $sel.classList.remove('is-open');
    $menu.setAttribute('hidden', '');
  }
});

// Toggle pixelate dentro de dither
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-bind="fe-edits-pixelate-on"]')) {
    const $wrap = document.querySelector('[data-bind="fe-edits-pixelate-wrap"]');
    if ($wrap) {
      if (e.target.checked) $wrap.removeAttribute('hidden');
      else $wrap.setAttribute('hidden', '');
    }
  }
});

// Sliders: atualiza label ao vivo
document.addEventListener('input', (e) => {
  const map = {
    'fe-edits-pixelate-size': 'fe-edits-pixelate-val',
    'fe-edits-niveis': 'fe-edits-niveis-val',
    'fe-edits-brilho': 'fe-edits-brilho-val',
    'fe-edits-contraste': 'fe-edits-contraste-val',
    'fe-edits-saturacao': 'fe-edits-saturacao-val',
  };
  for (const [src, dst] of Object.entries(map)) {
    if (e.target.matches(`[data-bind="${src}"]`)) {
      const $v = document.querySelector(`[data-bind="${dst}"]`);
      if ($v) $v.textContent = e.target.value;
      e.target.dataset.touched = '1';
    }
  }
});

// Confirmar
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-confirm-edits"]')) return;
  const m = document.querySelector('[data-modal="fe-edits"]');
  const $err = m.querySelector('[data-bind="fe-edits-err"]');
  $err.textContent = '';
  if (!alvosAtuais.length) {
    $err.textContent = 'sem alvos';
    return;
  }
  const usarOriginal = m.querySelector('[data-bind="fe-edits-use-original"]').checked;
  let opParams = {};
  if (opSelecionada === 'dither') {
    const pixelateOn = m.querySelector('[data-bind="fe-edits-pixelate-on"]').checked;
    if (pixelateOn) {
      const sz = parseInt(m.querySelector('[data-bind="fe-edits-pixelate-size"]').value, 10);
      opParams.pixelate = { tamanho: sz };
    }
    opParams.algoritmo = algoSelecionado;
    opParams.paleta = paletaSelecionada;
    const $niveis = m.querySelector('[data-bind="fe-edits-niveis"]');
    if ($niveis && !$niveis.closest('[hidden]')) {
      opParams.niveis = parseInt($niveis.value, 10);
    }
  } else if (opSelecionada === 'adjust') {
    opParams.brilho = parseInt(m.querySelector('[data-bind="fe-edits-brilho"]').value, 10);
    opParams.contraste = parseInt(m.querySelector('[data-bind="fe-edits-contraste"]').value, 10);
    opParams.saturacao = parseInt(m.querySelector('[data-bind="fe-edits-saturacao"]').value, 10);
  }
  try {
    const r = await dispararEdicao({
      tirinhaId: window._feTirinhaIdAtual || null,
      celulasIds: alvosAtuais,
      opType: opSelecionada,
      opParams,
      usarOriginal,
    });
    const n = r.celulas_marcadas?.length || 0;
    showToast(n === 0 ? 'nenhuma celula valida' : `processando ${n} celula${n === 1 ? '' : 's'}`);
    closeModal();
    if (onConfirmCb) onConfirmCb(r);
  } catch (err) {
    $err.textContent = err.message;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
