// Frames Editor · Stroke renderer.
// Coordena interpolação de pontos + modulações (pressure, tilt, jitter,
// falloff, taper) + chamada do stamp builder.

import { buildColoredTip, buildStampWithGrain } from './fe_brush_stamp.js';

function rand(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function createBrushStroke(ctx, brush, opts = {}) {
  const baseColor = opts.color || '#000000';
  const baseSize = opts.size || 32;
  const erase = !!opts.erase;
  const m = brush.meta;

  let prev = null;
  let accDist = 0;
  let totalDist = 0;
  let stampCount = 0;
  let grainAccX = 0;
  let grainAccY = 0;

  // taperStartLength é fração [0..1] do stroke. Sem comprimento total em tempo
  // real, uso uma referência de "stroke típico" (200px) — taper visível mas
  // não fiel ao Procreate. taperEndLength: não implementado (precisaria render
  // offscreen do stroke pra aplicar no finish).
  const TAPER_REF_PX = 200;
  const taperStartPx = (m.taperStartLength ?? 0) * TAPER_REF_PX;

  // Cache de tip colorizado por size discreto (chave = size arredondado pra 2px).
  const tipCache = new Map();
  function getColoredTip(sizePx) {
    const key = Math.max(2, Math.round(sizePx / 2) * 2);
    let s = tipCache.get(key);
    if (!s) {
      s = buildColoredTip(brush.tip, baseColor, key);
      tipCache.set(key, s);
    }
    return s;
  }

  // Canvas auxiliar reutilizado pra montar tip+grain por stamp.
  const stampOff = document.createElement('canvas');
  const stampCtx = stampOff.getContext('2d');

  if (erase) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
  }

  function _stamp(x, y, pressure, segAngle, tiltMag, distFromStart) {
    const pSizeAmount = m.pressureSize ?? 0;
    const pOpacityAmount = m.pressureOpacity ?? 0;
    const jSize = m.jitterSize ?? 0;
    const jOpacity = m.jitterOpacity ?? 0;

    const sizeFactor = 1 - pSizeAmount + pSizeAmount * pressure;
    const opacityFactor = 1 - pOpacityAmount + pOpacityAmount * pressure;

    const sizeJit = 1 + (rand(stampCount * 2.13) - 0.5) * jSize;
    const opacityJit = 1 + (rand(stampCount * 3.71) - 0.5) * jOpacity;

    // TILT: modulação por inclinação da caneta. Magnitude 0..1.
    const tiltSize = m.tiltSize ?? 0;
    const tiltOpacityAmount = m.tiltOpacity ?? 0;
    const tiltSizeFactor = 1 + tiltSize * tiltMag;
    const tiltOpacityFactor = 1 - tiltOpacityAmount + tiltOpacityAmount * (1 - tiltMag);

    // FALLOFF: fade exponencial da opacidade conforme distância acumulada.
    // Sem comprimento total, uso decay constante por px. Aproximação.
    const falloff = m.dynamicsFalloff ?? 0;
    const falloffFactor = falloff > 0
      ? Math.exp(-distFromStart * falloff * 0.005)
      : 1;

    // TAPER START: easeIn pros primeiros taperStartPx do stroke.
    let taperFactor = 1;
    if (taperStartPx > 0 && distFromStart < taperStartPx) {
      const t = distFromStart / taperStartPx;
      taperFactor = 1 - Math.pow(1 - t, 3); // ease-out cubic
    }
    const taperSizeAmount = m.taperSize ?? 0;
    const taperOpAmount = m.taperOpacity ?? 0;
    const sizeTaper = (taperSizeAmount > 0 ? taperSizeAmount : 1) * (1 - taperFactor);
    const opTaper = (taperOpAmount > 0 ? taperOpAmount : 1) * (1 - taperFactor);

    let sizePx = baseSize * sizeFactor * sizeJit * tiltSizeFactor * (1 - sizeTaper);
    sizePx = Math.max(1, sizePx);

    let alpha = (m.paintOpacity ?? 1) * opacityFactor * opacityJit
              * tiltOpacityFactor * falloffFactor * (1 - opTaper);
    alpha = Math.max(0, Math.min(1, alpha));

    let sx = x, sy = y;

    // PLOT JITTER: deslocamento perpendicular à direção do traço, proporcional ao size.
    const pJitter = m.plotJitter ?? 0;
    if (pJitter > 0 && segAngle !== null) {
      const perpX = -Math.sin(segAngle);
      const perpY = Math.cos(segAngle);
      const offset = (rand(stampCount * 11.23) - 0.5) * 2 * pJitter * sizePx;
      sx += perpX * offset;
      sy += perpY * offset;
    }

    // SCATTER: deslocamento radial aleatório (independente do plotJitter)
    if ((m.scatter ?? 0) > 0) {
      const ang = rand(stampCount * 7.91) * Math.PI * 2;
      const r = rand(stampCount * 1.13) * m.scatter * sizePx * 0.3;
      sx += Math.cos(ang) * r;
      sy += Math.sin(ang) * r;
    }

    // ROTAÇÃO: shapeRotation tem significado pra 0..1 sem fonte pública.
    // Não rotacionamos. Campo aparece em __notImplemented quando ≠ 0.
    const rot = 0;

    // Grain offset pra este stamp
    let grainOffX = 0, grainOffY = 0;
    if (brush.grain && m.grainDepth > 0 && !erase) {
      if (m.grainMovement === 'follows') {
        grainOffX = grainAccX * 0.7;
        grainOffY = grainAccY * 0.7;
      } else {
        grainOffX = sx * 1.3;
        grainOffY = sy * 1.3;
      }
    }

    const wantsGrain = brush.grain && m.grainDepth > 0 && !erase;
    const coloredTip = getColoredTip(sizePx);
    let stampW;
    if (wantsGrain) {
      stampW = buildStampWithGrain({
        stampOff, stampCtx,
        coloredTip,
        grain: brush.grain,
        textureScale: m.textureScale ?? 1,
        grainOffX, grainOffY,
        grainDepth: m.grainDepth,
      });
    } else {
      stampW = coloredTip.width;
    }
    const halfW = stampW / 2;

    ctx.save();
    ctx.globalAlpha = erase ? 1 : alpha;
    ctx.translate(sx, sy);
    if (rot) ctx.rotate(rot);
    if (wantsGrain) {
      ctx.drawImage(stampOff, 0, 0, stampW, stampW, -halfW, -halfW, stampW, stampW);
    } else {
      ctx.drawImage(coloredTip, -halfW, -halfW);
    }
    ctx.restore();

    stampCount++;
  }

  function addPoint(x, y, pressure = 0.5, tiltX = 0, tiltY = 0) {
    const tiltMag = Math.min(1, Math.hypot(tiltX, tiltY) / 90);

    if (!prev) {
      prev = { x, y, pressure };
      _stamp(x, y, pressure, null, tiltMag, 0);
      accDist = 0;
      totalDist = 0;
      return;
    }
    const dx = x - prev.x;
    const dy = y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 0) return;

    const segAngle = Math.atan2(dy, dx);

    const pSizeAmount = m.pressureSize ?? 0;
    const avgP = (prev.pressure + pressure) / 2;
    const sizeFactor = 1 - pSizeAmount + pSizeAmount * avgP;
    const sizePx = Math.max(1, baseSize * sizeFactor);
    const step = Math.max(0.5, (m.spacing ?? 0.1) * sizePx);

    const ux = dx / segLen;
    const uy = dy / segLen;
    const dp = pressure - prev.pressure;

    let traveled = 0;
    while (true) {
      const needed = step - accDist;
      if (traveled + needed > segLen) break;
      traveled += needed;
      const sx = prev.x + ux * traveled;
      const sy = prev.y + uy * traveled;
      const sp = prev.pressure + dp * (traveled / segLen);
      grainAccX += needed * 0.5;
      grainAccY += needed * 0.5;
      totalDist += needed;
      _stamp(sx, sy, sp, segAngle, tiltMag, totalDist);
      accDist = 0;
    }
    const leftover = segLen - traveled;
    accDist += leftover;
    totalDist += leftover;

    prev = { x, y, pressure };
  }

  function finish() {
    if (erase) ctx.restore();
    prev = null;
  }

  return { addPoint, finish };
}
