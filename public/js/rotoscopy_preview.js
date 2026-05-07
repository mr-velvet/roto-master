// Preview animado da camada de rotoscopia de um asset .aseprite.
// Card e modal usam pra mostrar o trabalho final animado quando status='done'.
// Lazy: só baixa e parseia quando attach() é chamado. Cache em memória por gcs_url.

import { parseAseprite, renderLayerFrames, pickRotoscopyLayer } from './aseprite_parser.js';

const cache = new Map(); // gcs_url -> Promise<{width, height, layerFrames}>

async function loadFrames(gcsUrl) {
  if (cache.has(gcsUrl)) return cache.get(gcsUrl);
  const p = (async () => {
    const r = await fetch(gcsUrl);
    if (!r.ok) throw new Error('fetch .aseprite: ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    const parsed = parseAseprite(buf);
    const layerIdx = pickRotoscopyLayer(parsed);
    const layerFrames = renderLayerFrames(parsed, layerIdx);
    return { width: parsed.width, height: parsed.height, layerFrames };
  })();
  cache.set(gcsUrl, p);
  // se falhar, descacheia pra permitir retry
  p.catch(() => cache.delete(gcsUrl));
  return p;
}

// Liga preview animado num <canvas>. Retorna controlador { play, pause, stop }.
// O canvas é redimensionado pra match do .aseprite. CSS controla tamanho exibido.
//
// gcsUrl: url do .aseprite no GCS
// canvas: HTMLCanvasElement
// opts.autoStart: começa tocando (default true)
// opts.loop: repete (default true)
export function attachRotoscopyPreview(gcsUrl, canvas, opts = {}) {
  const autoStart = opts.autoStart !== false;
  const loop = opts.loop !== false;
  let frames = null;
  let frameIdx = 0;
  let timer = null;
  let stopped = false;
  let playing = false;
  const ctx = canvas.getContext('2d');

  function drawFrame(i) {
    if (!frames || stopped) return;
    const f = frames.layerFrames[i];
    const imageData = new ImageData(f.imageData, frames.width, frames.height);
    ctx.putImageData(imageData, 0, 0);
  }

  function tick() {
    if (!frames || stopped || !playing) return;
    const f = frames.layerFrames[frameIdx];
    drawFrame(frameIdx);
    timer = setTimeout(() => {
      frameIdx++;
      if (frameIdx >= frames.layerFrames.length) {
        if (loop) frameIdx = 0;
        else { playing = false; return; }
      }
      tick();
    }, Math.max(20, f.durationMs)); // mínimo 20ms pra não travar
  }

  loadFrames(gcsUrl).then((f) => {
    if (stopped) return;
    frames = f;
    canvas.width = f.width;
    canvas.height = f.height;
    drawFrame(0);
    if (autoStart) {
      playing = true;
      tick();
    }
  }).catch((err) => {
    console.warn('rotoscopy preview falhou:', err.message);
  });

  return {
    play() {
      if (stopped || playing) return;
      playing = true;
      tick();
    },
    pause() {
      playing = false;
      if (timer) { clearTimeout(timer); timer = null; }
    },
    reset() {
      frameIdx = 0;
      if (frames) drawFrame(0);
    },
    stop() {
      stopped = true;
      playing = false;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}
