// Ateliê → Texto → Vídeo (Fluxo D): prompt rigoroso/livre → vídeo, SEM imagem inicial.
// Síncrono: trava UI durante geração. Reusa visuais do fluxo C (chips, cards de attempt).

import { listModels, generateTextVideo, enhancePrompt, setActiveAttempt } from './generate_api.js';
import { showToast, openModal, closeModal, confirmModal } from './modals.js';
import { navigateEditor, navigateAtelie } from './router.js';
import { notifyJobEnqueued } from './notif_tray.js';

// === paletas de chips (em inglês — vão direto pro prompt) ===
// Cada item: label exibido = label que entra no prompt. Mantemos curto e
// padronizado pra o builder não precisar reescrever.
const PRESETS = {
  camera_start: [
    'wide shot', 'medium shot', 'close-up', 'extreme close-up',
    'over-the-shoulder', 'low-angle shot', 'high-angle shot',
    'Dutch tilt', 'POV shot', 'top-down overhead',
  ],
  camera_movement: [
    'static locked-off shot', 'slow push-in', 'slow pull-back',
    'dolly left', 'dolly right', 'pan left to right', 'pan right to left',
    'tilt up', 'tilt down', 'orbit around the subject',
    'handheld follow', 'crane rising', 'crane descending',
  ],
  camera_end: [
    'wide reveal', 'medium shot', 'close-up', 'extreme close-up',
    'over-the-shoulder', 'low-angle', 'high-angle', 'wide overhead',
  ],
  lighting: [
    'golden hour backlight', 'blue hour', 'overcast diffused light',
    'harsh midday sun', 'soft window light from camera-left',
    'neon-lit interior', 'candlelight flicker', 'moonlight',
    'three-point softbox setup', 'chiaroscuro high-contrast',
  ],
  atmosphere: [
    'tense', 'serene', 'melancholic', 'joyful',
    'ominous', 'dreamlike', 'gritty', 'ethereal',
  ],
  style: [
    'cinematic 35mm', 'anime', 'Pixar 3D animation', 'oil painting in motion',
    'watercolor', 'documentary handheld', '80s film grain', 'film noir',
  ],
};

// === refs DOM ===
const $tabs = document.querySelectorAll('[data-action="t2v-set-mode"]');
const $paneFree = document.querySelector('[data-bind="t2v-pane-free"]');
const $paneStructured = document.querySelector('[data-bind="t2v-pane-structured"]');

const $freePrompt = document.querySelector('[data-bind="t2v-free-prompt"]');
const $freeUndo = document.querySelector('[data-bind="t2v-free-undo"]');

const $scene = document.querySelector('[data-bind="t2v-scene"]');
const $subject = document.querySelector('[data-bind="t2v-subject"]');
const $physics = document.querySelector('[data-bind="t2v-physics"]');

const $generateBtn = document.querySelector('[data-bind="t2v-generate-btn"]');
const $generateLabel = document.querySelector('[data-bind="t2v-generate-label"]');
const $previewBtn = document.querySelector('[data-bind="t2v-preview-btn"]');
const $cost = document.querySelector('[data-bind="t2v-cost"]');
const $status = document.querySelector('[data-bind="t2v-status"]');
const $err = document.querySelector('[data-bind="t2v-err"]');

const $attempts = document.querySelector('[data-bind="t2v-attempts"]');
const $attemptsCount = document.querySelector('[data-bind="t2v-attempts-count"]');
const $attemptsList = document.querySelector('[data-bind="t2v-attempts-list"]');
const $finalize = document.querySelector('[data-bind="t2v-finalize"]');

const $previewPrompt = document.querySelector('[data-bind="t2v-preview-prompt"]');
const $previewErr = document.querySelector('[data-bind="t2v-preview-err"]');

// === estado ===
let mode = 'free';                  // 'free' | 'structured'
let durationS = 5;
// 'auto' = deriva da duração; 'kling' / 'pixverse' = override.
let modelChoice = 'auto';
let modelsByKey = {};
let videoId = null;
let videoActiveIdx = 0;
let videoAttempts = [];
let lastBody = null;

// estrutura: campos do modo rigoroso
const fields = {
  scene: '', subject: '',
  camera_start: '', camera_movement: '', camera_end: '',
  lighting: '', atmosphere: '', style: '',
  physics: '',
};

// flag pra detectar se o prompt compilado foi editado manualmente
// no modal — vira mode 'structured-edited' na telemetria.
let compiledOriginal = '';

// === bootstrap ===
let initialized = false;
export async function showAtelieTextVideo() {
  if (!initialized) {
    initialized = true;
    renderChips();
    wireChipCustomInputs();
    try {
      const models = await listModels();
      modelsByKey = Object.fromEntries(models.map((m) => [m.key, m]));
    } catch (e) {
      console.warn('falha ao listar modelos:', e);
    }
  }
  resetAll();
  updateCostLabel();
}

function resetAll() {
  mode = 'free';
  durationS = 5;
  modelChoice = 'auto';
  videoId = null;
  videoActiveIdx = 0;
  videoAttempts = [];
  lastBody = null;

  $freePrompt.value = '';
  $scene.value = '';
  $subject.value = '';
  $physics.value = '';

  Object.keys(fields).forEach((k) => { fields[k] = ''; });
  document.querySelectorAll('.t2v-chips .t2v-chip').forEach((c) => c.classList.remove('is-active'));
  document.querySelectorAll('.t2v-chip-custom').forEach((i) => { i.value = ''; });

  setTab('free');
  if ($t2vDurInput) $t2vDurInput.value = '5';
  updateCostLabel();
  $err.textContent = '';
  $status.setAttribute('hidden', '');
  $attempts.setAttribute('hidden', '');
  $finalize.setAttribute('hidden', '');
  $generateLabel.textContent = 'gerar vídeo';
  $freeUndo.setAttribute('hidden', '');
}

function effectiveVideoModel() {
  let key;
  if (modelChoice === 'kling') key = 'kling-t2v';
  else if (modelChoice === 'pixverse') key = 'pixverse-t2v';
  else key = durationS < 5 ? 'pixverse-t2v' : 'kling-t2v';
  if (key === 'pixverse-t2v') {
    return { key, label: 'PixVerse V6', modelId: 'fal-ai/pixverse/v6/text-to-video' };
  }
  return { key, label: 'Kling 2.5 Turbo', modelId: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video' };
}

function clampDurationForModel(d, key) {
  if (key === 'kling-t2v') return d <= 7 ? 5 : 10;
  return Math.max(1, Math.min(15, Math.round(d)));
}

function updateCostLabel() {
  const m = effectiveVideoModel();
  const realDur = clampDurationForModel(durationS, m.key);
  const entry = modelsByKey[m.modelId];
  if (entry) {
    $cost.textContent = `~$${(parseFloat(entry.cost_per_unit) * realDur).toFixed(2)} / ${realDur}s`;
  }
  updateModelUI();
}

function updateModelUI() {
  const $label = document.querySelector('[data-bind="t2v-duration-label"]');
  const $pill = document.querySelector('[data-bind="t2v-model-pill"]');
  const $hint = document.querySelector('[data-bind="t2v-model-hint"]');
  const m = effectiveVideoModel();
  if ($label) $label.textContent = `${durationS}s`;
  if ($pill) {
    $pill.textContent = m.label;
    $pill.classList.toggle('is-pixverse', m.key === 'pixverse-t2v');
    $pill.classList.toggle('is-kling', m.key === 'kling-t2v');
  }
  if ($hint) {
    if (modelChoice === 'auto') {
      $hint.textContent = m.key === 'pixverse-t2v' ? 'curto (auto)' : 'qualidade (auto)';
    } else {
      $hint.textContent = 'manual · click pra voltar a auto';
    }
  }
}

// === chips ===
function renderChips() {
  for (const key of Object.keys(PRESETS)) {
    const wrap = document.querySelector(`[data-bind="t2v-${key.replace('_', '-')}"]`);
    if (!wrap) continue;
    wrap.innerHTML = '';
    PRESETS[key].forEach((label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 't2v-chip';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const isActive = btn.classList.contains('is-active');
        // chips são single-select por categoria
        wrap.querySelectorAll('.t2v-chip').forEach((c) => c.classList.remove('is-active'));
        const customInput = wrap.parentElement.querySelector('.t2v-chip-custom');
        if (isActive) {
          // re-clicar desmarca
          fields[key] = '';
        } else {
          btn.classList.add('is-active');
          fields[key] = label;
          if (customInput) customInput.value = '';
        }
      });
      wrap.appendChild(btn);
    });
  }
}

function wireChipCustomInputs() {
  // text-input "ou descreva" desativa chip selecionado e usa texto livre
  document.querySelectorAll('.t2v-chip-custom').forEach((input) => {
    input.addEventListener('input', () => {
      const v = input.value.trim();
      // descobrir qual key esse input controla
      const wrap = input.parentElement.querySelector('.t2v-chips');
      if (!wrap) return;
      const key = wrap.getAttribute('data-bind').replace('t2v-', '').replace('-', '_');
      if (v) {
        fields[key] = v;
        wrap.querySelectorAll('.t2v-chip').forEach((c) => c.classList.remove('is-active'));
      } else {
        // se input limpou e nenhum chip ativo, vira ''
        const anyActive = wrap.querySelector('.t2v-chip.is-active');
        if (!anyActive) fields[key] = '';
      }
    });
  });
}

// === tabs ===
function setTab(target) {
  mode = target;
  $tabs.forEach((t) => {
    const isActive = t.getAttribute('data-mode') === target;
    t.classList.toggle('is-active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (target === 'free') {
    $paneFree.removeAttribute('hidden');
    $paneStructured.setAttribute('hidden', '');
    $previewBtn.style.display = 'none';
  } else {
    $paneFree.setAttribute('hidden', '');
    $paneStructured.removeAttribute('hidden');
    $previewBtn.style.display = '';
  }
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-action="t2v-set-mode"]');
  if (!tab) return;
  setTab(tab.getAttribute('data-mode'));
});

// === duração + modelo ===
const $t2vDurInput = document.querySelector('[data-bind="t2v-duration-input"]');
$t2vDurInput?.addEventListener('input', () => {
  const v = parseInt($t2vDurInput.value, 10);
  durationS = Number.isFinite(v) ? Math.max(1, Math.min(15, v)) : 5;
  updateCostLabel();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="t2v-toggle-model"]')) return;
  if (modelChoice === 'auto') modelChoice = 'kling';
  else if (modelChoice === 'kling') modelChoice = 'pixverse';
  else modelChoice = 'auto';
  updateCostLabel();
});

// === builder de prompt rigoroso (espelha lib/prompt-recipes.js#buildT2VPrompt) ===
// Mantemos uma versão client-side pro preview.
function buildStructuredPrompt() {
  // sincroniza textareas livres → fields
  fields.scene = $scene.value.trim();
  fields.subject = $subject.value.trim();
  fields.physics = $physics.value.trim();

  const dur = durationS;
  const parts = [];

  parts.push(fields.style
    ? `A ${dur}-second cinematic shot in ${fields.style} style.`
    : `A ${dur}-second cinematic shot.`);

  if (fields.subject || fields.scene) {
    const bits = [];
    if (fields.subject) bits.push(fields.subject);
    if (fields.scene) bits.push(fields.scene);
    parts.push('Scene: ' + bits.join('. ') + '.');
  }

  if (fields.camera_start) {
    parts.push(`The shot opens with a ${fields.camera_start}.`);
  }

  if (fields.camera_movement) {
    if (fields.camera_end && fields.camera_end !== fields.camera_start) {
      parts.push(`Over the ${dur} seconds, the camera performs a ${fields.camera_movement}, ending on a ${fields.camera_end}.`);
    } else {
      parts.push(`Over the ${dur} seconds, the camera performs a ${fields.camera_movement}.`);
    }
  } else if (fields.camera_end && fields.camera_end !== fields.camera_start) {
    parts.push(`The framing transitions to a ${fields.camera_end} by the end.`);
  }

  if (fields.lighting || fields.atmosphere) {
    const lit = [];
    if (fields.lighting) lit.push(fields.lighting);
    if (fields.atmosphere) lit.push(`${fields.atmosphere} mood`);
    parts.push('Lighting: ' + lit.join(', ') + '.');
  }

  if (fields.physics) {
    parts.push(fields.physics + (/[.!?]$/.test(fields.physics) ? '' : '.'));
  }

  return parts.join(' ');
}

// === preview do prompt compilado (modo rigoroso) ===
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="t2v-preview"]')) return;
  if (mode !== 'structured') return;
  const compiled = buildStructuredPrompt();
  if (!compiled || compiled.length < 30) {
    showToast('preencha pelo menos a cena e algum campo de câmera');
    return;
  }
  compiledOriginal = compiled;
  $previewPrompt.value = compiled;
  $previewErr.textContent = '';
  openModal('t2v-prompt-preview');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="t2v-confirm-generate"]')) return;
  const finalPrompt = $previewPrompt.value.trim();
  if (!finalPrompt) {
    $previewErr.textContent = 'prompt vazio';
    return;
  }
  closeModal();
  const wasEdited = finalPrompt !== compiledOriginal;
  const m = effectiveVideoModel();
  const realDur = clampDurationForModel(durationS, m.key);
  runGenerate({
    prompt: finalPrompt,
    duration_s: realDur,
    model_key: m.key,
    video_id: videoId,
    mode: wasEdited ? 'structured-edited' : 'structured',
    structured: { ...fields, duration_s: realDur },
  });
});

// === enfileirar (assíncrono) ===
async function runGenerate(body) {
  const mDeriv = effectiveVideoModel();
  const realDur = clampDurationForModel(body.duration_s || durationS, mDeriv.key);
  const entry = modelsByKey[mDeriv.modelId];
  const cost = entry ? parseFloat(entry.cost_per_unit) * realDur : null;
  const costStr = cost ? `~$${cost.toFixed(2)}` : 'custo não disponível';
  const ok = await confirmModal({
    title: 'Gerar vídeo',
    message: `Vai custar ${costStr} (${mDeriv.label} · ${realDur}s). Cobrança no provider acontece no envio. O vídeo gera em background — fica acompanhando pelo sino no header. Confirmar?`,
    danger: false,
    confirmLabel: `gerar (${costStr})`,
  });
  if (!ok) return;
  body.duration_s = realDur;
  body.model_key = mDeriv.key;

  $err.textContent = '';
  $generateBtn.disabled = true;
  $previewBtn.disabled = true;
  try {
    await generateTextVideo(body);
    notifyJobEnqueued();
    showToast('vídeo na fila — vou avisar quando terminar', 6000);
    lastBody = body;
    // limpa o prompt no modo livre pra abrir caminho pra próxima ideia
    if (body.mode === 'free') {
      $freePrompt.value = '';
    }
  } catch (e) {
    $err.textContent = 'falha ao enfileirar — tente de novo';
  } finally {
    $generateBtn.disabled = false;
    $previewBtn.disabled = false;
  }
}

// botão principal: no modo livre dispara direto; no rigoroso só
// dispara se o prompt já foi confirmado via preview-modal.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="t2v-generate"]')) return;
  if (mode === 'free') {
    const prompt = $freePrompt.value.trim();
    if (!prompt) {
      $err.textContent = 'escreva um prompt';
      return;
    }
    runGenerate({
      prompt,
      duration_s: durationS,
      video_id: videoId,
      mode: 'free',
    });
  } else {
    // abre preview pra usuário aprovar/editar antes
    document.querySelector('[data-action="t2v-preview"]')?.click();
  }
});

// === attempts ===
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
    const modeTag = att.mode === 'structured' ? ' · rigoroso'
                  : att.mode === 'structured-edited' ? ' · rigoroso editado'
                  : att.mode === 'free' ? ' · livre' : '';
    card.innerHTML = `
      <video class="generate-attempt-thumb" src="${att.url}" muted playsinline preload="metadata"></video>
      <div class="generate-attempt-meta">
        <div class="generate-attempt-title">tentativa ${i + 1}${i === videoActiveIdx ? ' · ativa' : ''}${modeTag}</div>
        <div class="generate-attempt-prompt">${escapeHtml((att.motion_prompt || '').slice(0, 120))}</div>
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

// === finalizar ===
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="t2v-open-editor"]')) return;
  if (!videoId) return;
  navigateEditor(videoId);
});

// voltar pra Vídeos via eyebrow ‹
document.addEventListener('click', (e) => {
  if (e.target.closest('.screen-atelie-text2video [data-action="goto-atelie-videos"]')) {
    window.location.hash = '#/atelie/videos';
  }
});

// === melhorar prompt (livre + compilado) ===
const enhanceTargets = {
  't2v-free': { textarea: $freePrompt, undo: $freeUndo, kind: 'motion-text' },
  't2v-compiled': { textarea: $previewPrompt, undo: null, kind: 'motion-text' },
};

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="enhance-prompt"]');
  if (!btn) return;
  const target = btn.getAttribute('data-target');
  const cfg = enhanceTargets[target];
  if (!cfg) return; // outros targets (image/motion) tratados em atelie_generate.js
  const original = cfg.textarea.value.trim();
  if (!original) {
    showToast('escreva algo primeiro');
    return;
  }
  btn.disabled = true;
  btn.classList.add('is-loading');
  const labelEl = btn.querySelector('.enhance-label');
  const origLabel = labelEl.textContent;
  labelEl.textContent = 'pensando...';
  try {
    const enhanced = await enhancePrompt({ prompt: original, kind: cfg.kind });
    cfg.textarea.value = enhanced;
    cfg.textarea.dataset.preEnhance = original;
    if (cfg.undo) cfg.undo.removeAttribute('hidden');
    showToast('prompt melhorado');
  } catch (err) {
    showToast('falha: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    labelEl.textContent = origLabel;
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.enhance-undo');
  if (!btn) return;
  if (btn.getAttribute('data-bind') !== 't2v-free-undo') return;
  const prev = $freePrompt.dataset.preEnhance;
  if (prev) {
    $freePrompt.value = prev;
    delete $freePrompt.dataset.preEnhance;
  }
  btn.setAttribute('hidden', '');
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
