// Ateliê → Gerar (Fluxo C): prompt → imagem → vídeo.
// Síncrono: trava UI durante geração, mostra status, custo e erros do provider.

import { listModels, generateImage, generateVideo, uploadRef, setActiveAttempt, enhancePrompt } from './generate_api.js';
import { showToast } from './modals.js';
import { navigateEditor } from './router.js';

// === refs DOM ===
const $imgPrompt = document.querySelector('[data-bind="gen-image-prompt"]');
const $refsList = document.querySelector('[data-bind="gen-refs"]');
const $refsInput = document.querySelector('[data-bind="gen-refs-input"]');
const $imgBtn = document.querySelector('[data-bind="gen-image-btn"]');
const $imgBtnLabel = document.querySelector('[data-bind="gen-image-btn-label"]');
const $imgRetry = document.querySelector('[data-bind="gen-image-retry"]');
const $imgStatus = document.querySelector('[data-bind="gen-image-status"]');
const $imgErr = document.querySelector('[data-bind="gen-image-err"]');
const $imgPreview = document.querySelector('[data-bind="gen-image-preview"]');
const $imgImg = document.querySelector('[data-bind="gen-image-img"]');
const $imgCost = document.querySelector('[data-bind="gen-image-cost"]');

const $videoPane = document.querySelector('[data-bind="gen-pane-video"]');
const $videoLockMsg = document.querySelector('[data-bind="gen-video-locked-msg"]');
const $videoBody = document.querySelector('[data-bind="gen-video-body"]');
const $baseImg = document.querySelector('[data-bind="gen-base-img"]');
const $motionPrompt = document.querySelector('[data-bind="gen-motion-prompt"]');
const $videoBtn = document.querySelector('[data-bind="gen-video-btn"]');
const $videoBtnLabel = document.querySelector('[data-bind="gen-video-btn-label"]');
const $videoRetry = document.querySelector('[data-bind="gen-video-retry"]');
const $videoStatus = document.querySelector('[data-bind="gen-video-status"]');
const $videoErr = document.querySelector('[data-bind="gen-video-err"]');
const $videoCost = document.querySelector('[data-bind="gen-video-cost"]');
const $attempts = document.querySelector('[data-bind="gen-attempts"]');
const $attemptsCount = document.querySelector('[data-bind="gen-attempts-count"]');
const $attemptsList = document.querySelector('[data-bind="gen-attempts-list"]');
const $finalize = document.querySelector('[data-bind="gen-finalize"]');

// === estado ===
let modelsByKey = {};
let imageUrl = null;        // URL da imagem ativa (escolhida pra etapa 2)
let imagePrompt = null;     // prompt usado pra gerar imageUrl
let refUrls = [];           // URLs das refs já uploadadas
let refLocalPreviews = [];  // {file, url:objectURL} pra preview antes do upload
let videoId = null;         // primeiro vídeo gerado vira id da workbench
let videoActiveIdx = 0;
let videoAttempts = [];
let durationS = 5;
let lastImageBody = null;   // pra retry
let lastVideoBody = null;

// === bootstrap ===
let initialized = false;
export async function showAtelieGenerate() {
  if (!initialized) {
    initialized = true;
    try {
      const models = await listModels();
      modelsByKey = Object.fromEntries(models.map((m) => [m.key, m]));
      updateCostLabels();
    } catch (e) {
      console.warn('falha ao listar modelos:', e);
    }
  }
  // toda vez que entra na tela, reseta estado
  resetAll();
}

function updateCostLabels() {
  const img = modelsByKey['fal-ai/nano-banana-pro'];
  if (img) $imgCost.textContent = `~$${parseFloat(img.cost_per_unit).toFixed(2)} / geração`;
  const vid = modelsByKey['fal-ai/kling-video/v2.5-turbo/pro/image-to-video'];
  if (vid) $videoCost.textContent = `~$${(parseFloat(vid.cost_per_unit) * durationS).toFixed(2)} / ${durationS}s`;
}

function resetAll() {
  imageUrl = null;
  imagePrompt = null;
  refUrls = [];
  refLocalPreviews.forEach((r) => URL.revokeObjectURL(r.url));
  refLocalPreviews = [];
  videoId = null;
  videoActiveIdx = 0;
  videoAttempts = [];
  durationS = 5;
  lastImageBody = null;
  lastVideoBody = null;

  $imgPrompt.value = '';
  $motionPrompt.value = '';
  $refsList.innerHTML = '';
  $imgPreview.setAttribute('hidden', '');
  $imgRetry.setAttribute('hidden', '');
  $imgErr.textContent = '';
  $imgStatus.setAttribute('hidden', '');
  $imgBtnLabel.textContent = 'gerar imagem';

  $videoPane.classList.add('is-locked');
  $videoBody.setAttribute('hidden', '');
  $videoLockMsg.style.display = '';
  $videoRetry.setAttribute('hidden', '');
  $videoErr.textContent = '';
  $videoStatus.setAttribute('hidden', '');
  $attempts.setAttribute('hidden', '');
  $finalize.setAttribute('hidden', '');
  document.querySelectorAll('[data-action="gen-set-duration"]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-duration') === '5');
  });
  updateCostLabels();
}

function unlockVideoPane() {
  $videoPane.classList.remove('is-locked');
  $videoBody.removeAttribute('hidden');
  $videoLockMsg.style.display = 'none';
  $baseImg.src = imageUrl;
}

// === refs upload (drag-drop / file picker) ===
$refsInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const localUrl = URL.createObjectURL(file);
    const wrap = document.createElement('div');
    wrap.className = 'generate-ref-item is-uploading';
    wrap.innerHTML = `
      <img src="${localUrl}" alt="ref" />
      <span class="generate-ref-status">subindo...</span>
      <button class="generate-ref-remove" type="button" hidden>×</button>
    `;
    $refsList.appendChild(wrap);
    try {
      const url = await uploadRef(file);
      refUrls.push(url);
      refLocalPreviews.push({ file, url: localUrl });
      wrap.classList.remove('is-uploading');
      wrap.querySelector('.generate-ref-status').remove();
      const btn = wrap.querySelector('.generate-ref-remove');
      btn.removeAttribute('hidden');
      btn.addEventListener('click', () => {
        const idx = refUrls.indexOf(url);
        if (idx >= 0) refUrls.splice(idx, 1);
        URL.revokeObjectURL(localUrl);
        wrap.remove();
      });
    } catch (err) {
      wrap.classList.add('is-failed');
      wrap.querySelector('.generate-ref-status').textContent = 'falhou';
      console.error('ref upload:', err);
    }
  }
});

// === gerar imagem ===
async function runGenImage(body) {
  $imgErr.textContent = '';
  $imgRetry.setAttribute('hidden', '');
  $imgBtn.disabled = true;
  $imgStatus.removeAttribute('hidden');
  $imgStatus.textContent = 'gerando imagem... isso leva ~30s';
  try {
    const result = await generateImage(body);
    imageUrl = result.image_url;
    imagePrompt = body.prompt;
    lastImageBody = body;

    $imgImg.src = imageUrl;
    $imgPreview.removeAttribute('hidden');
    $imgStatus.setAttribute('hidden', '');
    $imgBtnLabel.textContent = 'gerar nova';
    $imgRetry.setAttribute('hidden', '');
    showToast(`imagem pronta — $${result.cost_actual?.toFixed(2) || '?'}`);

    unlockVideoPane();
  } catch (e) {
    $imgStatus.setAttribute('hidden', '');
    $imgErr.textContent = e.message;
    $imgRetry.removeAttribute('hidden');
  } finally {
    $imgBtn.disabled = false;
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="gen-image"]')) return;
  const prompt = $imgPrompt.value.trim();
  if (!prompt) {
    $imgErr.textContent = 'descreva a cena';
    return;
  }
  runGenImage({ prompt, ref_image_urls: refUrls.slice() });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="gen-image-retry"]')) return;
  if (lastImageBody) runGenImage(lastImageBody);
});

// === duração ===
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="gen-set-duration"]');
  if (!btn) return;
  durationS = btn.getAttribute('data-duration') === '10' ? 10 : 5;
  document.querySelectorAll('[data-action="gen-set-duration"]').forEach((b) => {
    b.classList.toggle('is-active', b === btn);
  });
  updateCostLabels();
});

// === gerar vídeo ===
async function runGenVideo(body) {
  $videoErr.textContent = '';
  $videoRetry.setAttribute('hidden', '');
  $videoBtn.disabled = true;
  $videoStatus.removeAttribute('hidden');
  $videoStatus.textContent = 'gerando vídeo... pode levar 1-2min';
  try {
    const result = await generateVideo(body);
    videoId = result.video.id;
    videoActiveIdx = result.attempt_idx;
    videoAttempts = result.video.generation_meta?.attempts || [];
    lastVideoBody = body;

    $videoStatus.setAttribute('hidden', '');
    $videoBtnLabel.textContent = 'gerar nova tentativa';
    renderAttempts();
    $finalize.removeAttribute('hidden');
    showToast('vídeo pronto');
  } catch (e) {
    $videoStatus.setAttribute('hidden', '');
    $videoErr.textContent = e.message;
    $videoRetry.removeAttribute('hidden');
  } finally {
    $videoBtn.disabled = false;
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="gen-video"]')) return;
  if (!imageUrl) return;
  const motion = $motionPrompt.value.trim();
  if (!motion) {
    $videoErr.textContent = 'descreva o movimento';
    return;
  }
  const body = {
    image_url: imageUrl,
    motion_prompt: motion,
    duration_s: durationS,
    image_prompt: imagePrompt,
    video_id: videoId, // null na primeira; existente nas seguintes
  };
  runGenVideo(body);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="gen-video-retry"]')) return;
  if (lastVideoBody) runGenVideo(lastVideoBody);
});

function renderAttempts() {
  if (!videoAttempts.length) {
    $attempts.setAttribute('hidden', '');
    return;
  }
  $attempts.removeAttribute('hidden');
  $attemptsCount.textContent = String(videoAttempts.length);
  $attemptsList.innerHTML = '';
  videoAttempts.forEach((att, i) => {
    const card = document.createElement('div');
    card.className = 'generate-attempt' + (i === videoActiveIdx ? ' is-active' : '');
    const ts = att.generated_at ? new Date(att.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    card.innerHTML = `
      <video class="generate-attempt-thumb" src="${att.url}" muted playsinline preload="metadata"></video>
      <div class="generate-attempt-meta">
        <div class="generate-attempt-title">tentativa ${i + 1}${i === videoActiveIdx ? ' · ativa' : ''}</div>
        <div class="generate-attempt-prompt">${escapeHtml((att.motion_prompt || '').slice(0, 80))}</div>
        <div class="generate-attempt-foot">${att.duration_s}s · ${ts}${att.cost ? ' · $' + parseFloat(att.cost).toFixed(2) : ''}</div>
      </div>
      ${i === videoActiveIdx ? '' : `<button class="generate-attempt-pick" data-idx="${i}" type="button">usar essa</button>`}
    `;
    const v = card.querySelector('video');
    v.addEventListener('mouseenter', () => v.play().catch(() => {}));
    v.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
    const pick = card.querySelector('.generate-attempt-pick');
    if (pick) pick.addEventListener('click', () => switchAttempt(i));
    $attemptsList.appendChild(card);
  });
}

async function switchAttempt(idx) {
  if (!videoId || idx === videoActiveIdx) return;
  try {
    const v = await setActiveAttempt(videoId, idx);
    videoActiveIdx = v.generation_meta?.active_attempt_idx ?? idx;
    videoAttempts = v.generation_meta?.attempts || [];
    renderAttempts();
    showToast('tentativa ativa trocada');
  } catch (e) {
    showToast('falha: ' + e.message);
  }
}

// === finalizar: leva pro editor ===
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="gen-open-editor"]')) return;
  if (!videoId) return;
  navigateEditor(videoId);
});

// === voltar pra Ateliê → Vídeos (botão no eyebrow) ===
document.addEventListener('click', (e) => {
  if (e.target.closest('.screen-atelie-generate [data-action="goto-atelie-videos"]')) {
    // router.js cuida via hash
    window.location.hash = '#/atelie/videos';
  }
});

// === melhorar prompt com IA ===
const enhanceConfig = {
  image: {
    textarea: $imgPrompt,
    btn: () => document.querySelector('[data-action="enhance-prompt"][data-target="image"]'),
    undo: () => document.querySelector('[data-bind="gen-image-undo"]'),
    kind: 'image',
  },
  motion: {
    textarea: $motionPrompt,
    btn: () => document.querySelector('[data-action="enhance-prompt"][data-target="motion"]'),
    undo: () => document.querySelector('[data-bind="gen-motion-undo"]'),
    kind: 'motion',
  },
};

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="enhance-prompt"]');
  if (!btn) return;
  const target = btn.getAttribute('data-target');
  const cfg = enhanceConfig[target];
  if (!cfg) return;
  const original = cfg.textarea.value.trim();
  if (!original) {
    showToast('escreva algo primeiro');
    return;
  }
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.querySelector('.enhance-label').textContent = 'pensando...';
  try {
    const enhanced = await enhancePrompt({ prompt: original, kind: cfg.kind });
    cfg.textarea.value = enhanced;
    cfg.textarea.dataset.preEnhance = original;
    const undoBtn = cfg.undo();
    undoBtn.removeAttribute('hidden');
    showToast('prompt melhorado');
  } catch (err) {
    showToast('falha: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.querySelector('.enhance-label').textContent = 'melhorar';
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.enhance-undo');
  if (!btn) return;
  const target = btn.getAttribute('data-bind') === 'gen-image-undo' ? 'image' : 'motion';
  const cfg = enhanceConfig[target];
  const prev = cfg.textarea.dataset.preEnhance;
  if (prev) {
    cfg.textarea.value = prev;
    delete cfg.textarea.dataset.preEnhance;
  }
  btn.setAttribute('hidden', '');
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
