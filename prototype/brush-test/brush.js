// Frames Editor · Stamp engine.
//
// Renderiza traços de pincel num canvas alvo. Independente do resto do editor.
// Brush definido por `meta.json` em public/brushes/<id>/ (gerado por
// scripts/brush-import.js a partir de .brushset do Procreate).
//
// API:
//   const brush = await loadBrush('/brushes/pencil-strokes-6');
//   const stroke = createBrushStroke(ctx, brush, { color, size });
//   stroke.addPoint(x, y, pressure);
//   ...
//   stroke.finish();
//
// `ctx` é um CanvasRenderingContext2D — pode ser do canvas visível ou de um
// offscreen. Coordenadas em px no espaço do ctx (sem zoom embutido).

const _imgCache = new Map();
function _loadImage(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  _imgCache.set(url, p);
  return p;
}

// O tip do Procreate vem como PNG grayscale (mode L) sem alpha. Convenção:
// branco = opaco, preto = transparente. Convertemos pra um canvas RGBA onde
// o canal alpha vem da luminância da tip — e o RGB é branco.
// Assim, quando colorimos com source-in/fillRect, a cor preserva a variação
// tonal da tip (não vira um bloco sólido).
function _prepTipCanvas(img) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const luma = px[i]; // r=g=b em grayscale
    px[i]     = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    px[i + 3] = luma;
  }
  cx.putImageData(data, 0, 0);
  return c;
}

// Grain do Procreate também é grayscale. Preto = max effect (escurece mais);
// branco = sem efeito. Pra multiply funcionar, o grain precisa ser carregado
// como RGB grayscale (não convertido). Aceitamos como vem.
function _prepGrainCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

export async function loadBrush(baseUrl) {
  const meta = await fetch(`${baseUrl}/meta.json`).then((r) => r.json());
  const tipImg = await _loadImage(`${baseUrl}/${meta.tip}`);
  const tip = _prepTipCanvas(tipImg);
  let grain = null;
  if (meta.grainTip && meta.grainDepth > 0) {
    // baseUrl pode ser absoluto ou relativo. new URL com `${baseUrl}/` como
    // base resolve `../shared/...` corretamente nos dois casos.
    const grainUrl = new URL(meta.grainTip, new URL(`${baseUrl}/`, location.href)).href;
    const grainImg = await _loadImage(grainUrl);
    grain = _prepGrainCanvas(grainImg);
  }
  return { meta, tip, grain, baseUrl };
}

// Sprite colorido (sem grain) — cacheado por (color, sizePx). O grain entra
// só na hora do stamp, com offset diferente a cada um.
function _buildColoredTip(brush, color, sizePx) {
  const { tip } = brush;
  const w = Math.max(1, Math.round(sizePx));
  const h = Math.max(1, Math.round(sizePx));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');

  // 1) Pinta retângulo da cor inteiro
  cx.fillStyle = color;
  cx.fillRect(0, 0, w, h);

  // 2) Multiplica pelo alpha da tip (destination-in): mantém só onde a tip
  // tem alpha — preserva variação tonal porque o tip preparado tem alpha
  // proporcional à luminância original.
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(tip, 0, 0, w, h);
  cx.globalCompositeOperation = 'source-over';
  return c;
}

function _rand(seed) {
  // jitter determinístico simples por stamp (não precisa ser bom — só variar)
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function createBrushStroke(ctx, brush, opts = {}) {
  const baseColor = opts.color || '#000000';
  const baseSize = opts.size || 32;
  const erase = !!opts.erase;
  const m = brush.meta;

  let prev = null;
  let prevTilt = { x: 0, y: 0 };   // último tilt observado (pra pointers sem tilt nativo)
  let accDist = 0;                  // distância acumulada desde o último stamp
  let totalDist = 0;                // distância total percorrida no stroke (pra taper start + falloff)
  let stampCount = 0;
  let grainAccX = 0;
  let grainAccY = 0;

  // taperStartLength é fração [0..1] do stroke. Sem saber o comprimento total
  // em tempo real, uso uma referência de "stroke típico" (200px) — taper visível
  // mas não fiel ao Procreate quando o stroke real for muito maior/menor.
  // taperEndLength: precisaria render offscreen do stroke pra aplicar no finish —
  // não implementado nessa rodada (ver __notImplemented quando ocorrer).
  const TAPER_REF_PX = 200;
  const taperStartPx = (m.taperStartLength ?? 0) * TAPER_REF_PX;

  // Cache de tips colorizados (sem grain) por tamanho-arredondado-pra-2px
  const tipCache = new Map();
  function _getColoredTip(sizePx) {
    const key = Math.max(2, Math.round(sizePx / 2) * 2);
    let s = tipCache.get(key);
    if (!s) {
      s = _buildColoredTip(brush, baseColor, key);
      tipCache.set(key, s);
    }
    return s;
  }

  // Canvas auxiliar reusado pra montar (tip-colorido × grain) por stamp.
  // Tamanho cresce conforme necessário; nunca encolhe.
  const stampOff = document.createElement('canvas');
  const stampCtx = stampOff.getContext('2d');
  function _buildStampWithGrain(sizePx, grainOffX, grainOffY) {
    const w = Math.max(2, Math.round(sizePx / 2) * 2);
    if (stampOff.width < w) { stampOff.width = w; stampOff.height = w; }
    stampCtx.clearRect(0, 0, stampOff.width, stampOff.height);

    // 1) Tip colorizado
    const tip = _getColoredTip(w);
    stampCtx.globalCompositeOperation = 'source-over';
    stampCtx.globalAlpha = 1;
    stampCtx.drawImage(tip, 0, 0);

    // 2) Grain por multiply, recortado pelo alpha do tip (source-atop)
    if (brush.grain && m.grainDepth > 0) {
      const g = brush.grain;
      // textureScale: tamanho do grain DENTRO da shape (raw 0..16).
      // Valor 1 = grain 1:1. Valor 8 = grain 8x maior dentro do stamp
      // (textura mais grossa, padrões maiores). Valor 0.5 = grain mais fino.
      const tScale = m.textureScale ?? 1;
      // Janela do grain a samplear: w / tScale (menor janela = grain parece maior)
      const sampleW = Math.max(1, Math.round(w / tScale));
      let gx = Math.floor(grainOffX) % g.width;
      let gy = Math.floor(grainOffY) % g.height;
      if (gx < 0) gx += g.width;
      if (gy < 0) gy += g.height;
      stampCtx.globalAlpha = m.grainDepth;
      stampCtx.globalCompositeOperation = 'multiply';
      const sw = Math.min(sampleW, g.width - gx);
      const sh = Math.min(sampleW, g.height - gy);
      // desenha a janela do grain esticada (ou comprimida) pra cobrir o stamp inteiro
      stampCtx.drawImage(g, gx, gy, sw, sh, 0, 0, w, w);
      // remover excesso fora do alpha do tip
      stampCtx.globalAlpha = 1;
      stampCtx.globalCompositeOperation = 'destination-in';
      stampCtx.drawImage(tip, 0, 0);
    }

    stampCtx.globalCompositeOperation = 'source-over';
    return w;
  }

  if (erase) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
  }

  // _stamp recebe x,y,pressure e contexto adicional do segmento (tangente e tilt).
  // distFromStart = totalDist no momento que esse stamp será posicionado.
  function _stamp(x, y, pressure, segAngle, tiltMag, distFromStart) {
    const pSizeAmount = m.pressureSize ?? 0;
    const pOpacityAmount = m.pressureOpacity ?? 0;
    const jSize = m.jitterSize ?? 0;
    const jOpacity = m.jitterOpacity ?? 0;

    const sizeFactor = 1 - pSizeAmount + pSizeAmount * pressure;
    const opacityFactor = 1 - pOpacityAmount + pOpacityAmount * pressure;

    const sizeJit = 1 + (_rand(stampCount * 2.13) - 0.5) * jSize;
    const opacityJit = 1 + (_rand(stampCount * 3.71) - 0.5) * jOpacity;

    // TILT: modulação por inclinação da caneta. Wacom expõe tiltX/Y em graus.
    // Magnitude = hypot(tiltX, tiltY) / 90 (normalizada 0..1).
    // tiltSize: amount em [0..1] de quanto a inclinação aumenta o size do brush.
    // tiltOpacity: idem pra opacity.
    const tiltSize = m.tiltSize ?? 0;
    const tiltOpacityAmount = m.tiltOpacity ?? 0;
    const tiltSizeFactor = 1 + tiltSize * tiltMag;
    const tiltOpacityFactor = 1 - tiltOpacityAmount + tiltOpacityAmount * (1 - tiltMag);

    // FALLOFF: fade exponencial da opacidade conforme distância acumulada.
    // dynamicsFalloff é fração — interpretação: rate de decaimento por px.
    // Procreate doc diz "fade do início ao fim"; sem comprimento total, uso
    // decaimento que produz fade visível em strokes "típicos".
    // Falloff=0.04 (Sko4 médio) com fator de escala dá fade leve em ~500px.
    const falloff = m.dynamicsFalloff ?? 0;
    const falloffFactor = falloff > 0
      ? Math.exp(-distFromStart * falloff * 0.005)
      : 1;

    // TAPER START: easeIn pros primeiros taperStartPx do stroke
    let taperFactor = 1;
    if (taperStartPx > 0 && distFromStart < taperStartPx) {
      const t = distFromStart / taperStartPx;
      // ease-out cubic — afila mais rápido nos primeiros px e suaviza
      taperFactor = 1 - Math.pow(1 - t, 3);
    }
    // taperSize: amount de quanto size é afetado por taper. 0 = só opacity, 1 = só size.
    const taperSizeAmount = m.taperSize ?? 0;
    const taperOpAmount = m.taperOpacity ?? 0;
    // se taperSizeAmount=0 e taperOpAmount=0, padrão = afeta os dois
    const sizeTaper = (taperSizeAmount > 0 ? taperSizeAmount : 1) * (1 - taperFactor);
    const opTaper = (taperOpAmount > 0 ? taperOpAmount : 1) * (1 - taperFactor);
    const sizeTaperFactor = 1 - sizeTaper;
    const opTaperFactor = 1 - opTaper;

    let sizePx = baseSize * sizeFactor * sizeJit * tiltSizeFactor * sizeTaperFactor;
    sizePx = Math.max(1, sizePx);

    let alpha = (m.paintOpacity ?? 1) * opacityFactor * opacityJit
              * tiltOpacityFactor * falloffFactor * opTaperFactor;
    alpha = Math.max(0, Math.min(1, alpha));

    let sx = x, sy = y;

    // PLOT JITTER: deslocamento perpendicular à direção do traço, proporcional ao size.
    // Raw 0..13.78 no Procreate decoder; Sko4 fica em 0..0.35 — usamos como
    // multiplicador direto sobre o size (0.35 × size = ±35% de deslocamento perpendicular).
    const pJitter = m.plotJitter ?? 0;
    if (pJitter > 0 && segAngle !== null) {
      // perpendicular ao segmento: rotaciona o vetor unitário 90°
      const perpX = -Math.sin(segAngle);
      const perpY = Math.cos(segAngle);
      const offset = (_rand(stampCount * 11.23) - 0.5) * 2 * pJitter * sizePx;
      sx += perpX * offset;
      sy += perpY * offset;
    }

    // SCATTER: deslocamento radial aleatório (independente do plotJitter)
    if ((m.scatter ?? 0) > 0) {
      const ang = _rand(stampCount * 7.91) * Math.PI * 2;
      const r = _rand(stampCount * 1.13) * m.scatter * sizePx * 0.3;
      sx += Math.cos(ang) * r;
      sy += Math.sin(ang) * r;
    }

    let rot = 0;
    if ((m.rotationRandom ?? 0) > 0) {
      rot = _rand(stampCount * 5.17) * Math.PI * 2 * m.rotationRandom;
    }

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
    let stampW;
    if (wantsGrain) {
      stampW = _buildStampWithGrain(sizePx, Math.floor(grainOffX), Math.floor(grainOffY));
    } else {
      // sem grain: usa o tip colorizado direto
      const tip = _getColoredTip(sizePx);
      stampW = tip.width;
    }
    const halfW = stampW / 2;

    ctx.save();
    ctx.globalAlpha = erase ? 1 : alpha;
    ctx.translate(sx, sy);
    if (rot) ctx.rotate(rot);
    if (wantsGrain) {
      // stampOff pode estar maior que stampW — pego só a região válida
      ctx.drawImage(stampOff, 0, 0, stampW, stampW, -halfW, -halfW, stampW, stampW);
    } else {
      const tip = _getColoredTip(sizePx);
      ctx.drawImage(tip, -halfW, -halfW);
    }
    ctx.restore();

    stampCount++;
  }

  // accDist = distância percorrida desde o último stamp.
  // Quando accDist >= step, estampa e subtrai step.
  function addPoint(x, y, pressure = 0.5, tiltX = 0, tiltY = 0) {
    // Tilt magnitude normalizada 0..1 (Wacom tiltX/Y em graus, máx ±90)
    const tiltMag = Math.min(1, Math.hypot(tiltX, tiltY) / 90);
    prevTilt = { x: tiltX, y: tiltY };

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

    // step em px (depende do tamanho do brush no segmento, modulado por pressão)
    const pSizeAmount = m.pressureSize ?? 0;
    const avgP = (prev.pressure + pressure) / 2;
    const sizeFactor = 1 - pSizeAmount + pSizeAmount * avgP;
    const sizePx = Math.max(1, baseSize * sizeFactor);
    const step = Math.max(0.5, (m.spacing ?? 0.1) * sizePx);

    const ux = dx / segLen;
    const uy = dy / segLen;
    const dp = pressure - prev.pressure;

    let traveled = 0; // quanto já andei dentro deste segmento (0..segLen)
    while (true) {
      const needed = step - accDist; // distância até o próximo stamp
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
    totalDist += leftover;  // distância total inclui pedaço sem stamp

    prev = { x, y, pressure };
  }

  function finish() {
    if (erase) ctx.restore();
    prev = null;
  }

  return { addPoint, finish };
}
