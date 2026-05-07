// Frames Editor · Home — lista de tirinhas + criar nova.

import {
  listTirinhas, deleteTirinha, patchTirinha,
  createTirinhaVazia, createTirinhaUpload, uploadPng,
} from './fe_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateFeEditor } from './router.js';
import { parseAsepriteParaFrameEditor } from './aseprite_io.js';

const $grid = document.querySelector('[data-bind="fe-tirinha-grid"]');
const $empty = document.querySelector('[data-bind="fe-tirinha-empty"]');

let tirinhas = [];
let currentOrigem = 'vazia';
let pendingFile = null; // .aseprite escolhido

export async function showFeHome() {
  await refresh();
}

async function refresh() {
  try {
    tirinhas = await listTirinhas();
  } catch (e) {
    console.error('list tirinhas:', e);
    showToast('falha ao listar tirinhas: ' + e.message);
    return;
  }
  render();
}

function render() {
  $grid.innerHTML = '';
  if (!tirinhas.length) {
    $empty.removeAttribute('hidden');
    return;
  }
  $empty.setAttribute('hidden', '');

  for (const t of tirinhas) {
    const card = document.createElement('div');
    card.className = 'fe-tirinha-card';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.fe-tirinha-card-actions')) return;
      if (e.target.closest('.fe-tirinha-card-name-input')) return;
      navigateFeEditor(t.id);
    });

    const updated = formatDate(t.updated_at);
    const dim = `${t.largura}×${t.altura}`;
    const thumbStyle = t.thumb_url
      ? `style="background-image:url('${t.thumb_url}'); background-size: contain; background-repeat: no-repeat; background-position: center;"`
      : '';
    card.innerHTML = `
      <div class="fe-tirinha-card-thumb${t.thumb_url ? ' has-thumb' : ''}" ${thumbStyle}>
        ${t.thumb_url ? '' : '<span class="fe-tirinha-mark">▥</span>'}
        <span class="fe-tirinha-card-dim">${dim}</span>
      </div>
      <div class="fe-tirinha-card-body">
        <div class="fe-tirinha-card-name" data-bind-name>${escapeHtml(t.nome)}</div>
        <div class="fe-tirinha-card-meta">editado ${updated}</div>
      </div>
      <div class="fe-tirinha-card-actions">
        <button class="fe-tirinha-card-btn" data-action="rename-tirinha" title="renomear" type="button">✎</button>
        <button class="fe-tirinha-card-btn fe-tirinha-card-btn-danger" data-action="delete-tirinha" title="apagar" type="button">×</button>
      </div>
    `;
    card.querySelector('[data-action="rename-tirinha"]').addEventListener('click', (e) => {
      e.stopPropagation();
      iniciarRename(card, t);
    });
    card.querySelector('[data-action="delete-tirinha"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmModal({
        title: 'apagar tirinha',
        message: `Apagar "${t.nome}"? Essa ação não pode ser desfeita.`,
      });
      if (!ok) return;
      try {
        await deleteTirinha(t.id);
        showToast('tirinha apagada');
        await refresh();
      } catch (err) {
        showToast('falha ao apagar: ' + err.message);
      }
    });
    $grid.appendChild(card);
  }
}

function iniciarRename(card, t) {
  const $name = card.querySelector('[data-bind-name]');
  const original = t.nome;
  const $input = document.createElement('input');
  $input.className = 'fe-tirinha-card-name-input';
  $input.type = 'text';
  $input.value = original;
  $input.maxLength = 200;
  $name.replaceWith($input);
  $input.focus();
  $input.select();

  let settled = false;
  const finalize = async (commit) => {
    if (settled) return;
    settled = true;
    const novoNome = $input.value.trim();
    if (commit && novoNome && novoNome !== original) {
      try {
        await patchTirinha(t.id, { nome: novoNome });
        t.nome = novoNome;
      } catch (err) {
        showToast('falha ao renomear: ' + err.message);
      }
    }
    render();
  };
  $input.addEventListener('blur', () => finalize(true));
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finalize(true);
    if (e.key === 'Escape') finalize(false);
  });
}

// === Modal de criar nova tirinha ===

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-new-tirinha"]')) return;
  abrirModalNovaTirinha();
});

function abrirModalNovaTirinha() {
  currentOrigem = 'vazia';
  pendingFile = null;
  const m = document.querySelector('[data-modal="fe-new-tirinha"]');
  m.querySelector('[data-bind="fe-vazia-nome"]').value = '';
  m.querySelector('[data-bind="fe-vazia-largura"]').value = 64;
  m.querySelector('[data-bind="fe-vazia-altura"]').value = 64;
  m.querySelector('[data-bind="fe-upload-nome"]').value = '';
  m.querySelector('[data-bind="fe-upload-input"]').value = '';
  m.querySelector('[data-bind="fe-upload-file-label"]').textContent = '▸ escolher arquivo .aseprite';
  m.querySelector('[data-bind="fe-upload-progress"]').setAttribute('hidden', '');
  m.querySelector('[data-bind="fe-new-tirinha-err"]').textContent = '';
  m.querySelectorAll('.fe-origin-tab').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-origin') === 'vazia');
  });
  m.querySelector('[data-bind="fe-pane-vazia"]').removeAttribute('hidden');
  m.querySelector('[data-bind="fe-pane-upload"]').setAttribute('hidden', '');
  openModal('fe-new-tirinha');
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-action="fe-pick-origin"]');
  if (!tab || tab.disabled) return;
  const origem = tab.getAttribute('data-origin');
  currentOrigem = origem;
  const m = document.querySelector('[data-modal="fe-new-tirinha"]');
  m.querySelectorAll('.fe-origin-tab').forEach((b) => {
    b.classList.toggle('is-active', b === tab);
  });
  m.querySelector('[data-bind="fe-pane-vazia"]').setAttribute('hidden', '');
  m.querySelector('[data-bind="fe-pane-upload"]').setAttribute('hidden', '');
  if (origem === 'vazia') m.querySelector('[data-bind="fe-pane-vazia"]').removeAttribute('hidden');
  if (origem === 'upload') m.querySelector('[data-bind="fe-pane-upload"]').removeAttribute('hidden');
  m.querySelector('[data-bind="fe-new-tirinha-err"]').textContent = '';
});

// File picker
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-bind="fe-upload-input"]')) return;
  const f = e.target.files && e.target.files[0];
  pendingFile = f || null;
  const m = document.querySelector('[data-modal="fe-new-tirinha"]');
  const $label = m.querySelector('[data-bind="fe-upload-file-label"]');
  if (f) {
    $label.textContent = '▣ ' + f.name + ' (' + Math.ceil(f.size / 1024) + ' KB)';
    if (!m.querySelector('[data-bind="fe-upload-nome"]').value.trim()) {
      // pré-preenche nome com o do arquivo (sem extensão)
      m.querySelector('[data-bind="fe-upload-nome"]').value = f.name.replace(/\.[^.]+$/, '');
    }
  } else {
    $label.textContent = '▸ escolher arquivo .aseprite';
  }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-confirm-new-tirinha"]')) return;
  const m = document.querySelector('[data-modal="fe-new-tirinha"]');
  const $err = m.querySelector('[data-bind="fe-new-tirinha-err"]');
  const $btn = m.querySelector('[data-bind="fe-new-tirinha-confirm"]');
  $err.textContent = '';

  if (currentOrigem === 'vazia') {
    const nome = m.querySelector('[data-bind="fe-vazia-nome"]').value.trim() || 'Tirinha sem título';
    const largura = parseInt(m.querySelector('[data-bind="fe-vazia-largura"]').value, 10);
    const altura = parseInt(m.querySelector('[data-bind="fe-vazia-altura"]').value, 10);
    if (!Number.isFinite(largura) || largura < 1 || largura > 4096) {
      $err.textContent = 'largura inválida (1-4096)'; return;
    }
    if (!Number.isFinite(altura) || altura < 1 || altura > 4096) {
      $err.textContent = 'altura inválida (1-4096)'; return;
    }
    $btn.disabled = true;
    try {
      const data = await createTirinhaVazia({ nome, largura, altura });
      closeModal();
      showToast('tirinha criada');
      navigateFeEditor(data.id);
    } catch (err) {
      $err.textContent = err.message;
    } finally {
      $btn.disabled = false;
    }
    return;
  }

  if (currentOrigem === 'upload') {
    if (!pendingFile) {
      $err.textContent = 'escolha um arquivo .aseprite';
      return;
    }
    const nomeBase = m.querySelector('[data-bind="fe-upload-nome"]').value.trim()
      || pendingFile.name.replace(/\.[^.]+$/, '')
      || 'Tirinha sem título';
    const $progress = m.querySelector('[data-bind="fe-upload-progress"]');
    const $progressFill = m.querySelector('[data-bind="fe-upload-progress-fill"]');
    const $progressMsg = m.querySelector('[data-bind="fe-upload-progress-msg"]');
    $btn.disabled = true;
    $progress.removeAttribute('hidden');
    $progressMsg.textContent = 'parseando…';
    $progressFill.style.width = '0%';

    try {
      const buf = await pendingFile.arrayBuffer();
      const estrutura = parseAsepriteParaFrameEditor(buf);

      const celulasNaoVazias = estrutura.celulas;
      const total = celulasNaoVazias.length;
      const celulasUploaded = []; // payload final pra POST /tirinhas

      for (let i = 0; i < total; i++) {
        const cel = celulasNaoVazias[i];
        $progressMsg.textContent = `subindo célula ${i + 1} de ${total}…`;
        $progressFill.style.width = `${Math.round(((i) / total) * 100)}%`;
        const blob = await rgbaParaPngBlob(cel.pixels_rgba, cel.largura, cel.altura);
        const { png_url, largura, altura } = await uploadPng({
          tirinhaId: '', // sem ID ainda — usa path provisório
          blob,
        });
        celulasUploaded.push({
          camada_indice: cel.camada_indice,
          quadro_indice: cel.quadro_indice,
          png_url,
          largura,
          altura,
        });
      }
      $progressMsg.textContent = 'finalizando…';
      $progressFill.style.width = '100%';

      const data = await createTirinhaUpload({
        nome: nomeBase,
        origem_meta: { nome_arquivo: pendingFile.name },
        largura: estrutura.largura,
        altura: estrutura.altura,
        camadas: estrutura.camadas.map((c, i) => ({ nome: c.nome, ordem: i, visivel: c.visivel })),
        quadros: estrutura.quadros.map((q, i) => ({ indice: i })),
        celulas: celulasUploaded,
      });
      closeModal();
      showToast(`tirinha criada (${total} células)`);
      navigateFeEditor(data.id);
    } catch (err) {
      console.error('upload tirinha:', err);
      $err.textContent = err.message;
      $progress.setAttribute('hidden', '');
    } finally {
      $btn.disabled = false;
    }
  }
});

// === Helpers ===

// Converte um buffer RGBA em PNG via canvas (toBlob).
async function rgbaParaPngBlob(rgba, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(w, h);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('falha ao gerar PNG'));
    }, 'image/png');
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const ms = now - d;
    if (ms < 60_000) return 'agora';
    if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'min atrás';
    if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + 'h atrás';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch (_) { return '—'; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
