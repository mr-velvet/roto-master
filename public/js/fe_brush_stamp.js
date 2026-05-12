// Frames Editor · Stamp builder.
// Constrói um stamp (tip-colorido + grain) num offscreen reutilizável.
// Não tem estado de stroke — só recebe brush + params do stamp atual.

// Constrói tip colorizado dado (brush, color, sizePx). Cacheado por (color, sizePx)
// fora desta função — quem chama gerencia o cache.
export function buildColoredTip(brushTip, color, sizePx) {
  const w = Math.max(1, Math.round(sizePx));
  const c = document.createElement('canvas');
  c.width = w; c.height = w;
  const cx = c.getContext('2d');
  cx.fillStyle = color;
  cx.fillRect(0, 0, w, w);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(brushTip, 0, 0, w, w);
  cx.globalCompositeOperation = 'source-over';
  return c;
}

// Aplica grain no stamp via multiply, recortado pelo alpha do tip.
// stampOff / stampCtx vêm do caller (reutilizado entre stamps pra reduzir GC).
// coloredTip já é o tip colorizado (cacheado).
// grain é o canvas de textura (1500x1500 nos Sko4).
// textureScale: raw do Procreate; >1 = grain maior dentro do stamp (textura mais grossa).
// grainOff: {x, y} em px no espaço do grain (varia por stamp pra criar variação).
// grainDepth: 0..1, força do multiply.
export function buildStampWithGrain({
  stampOff, stampCtx,
  coloredTip,
  grain, textureScale = 1, grainOffX = 0, grainOffY = 0, grainDepth = 0,
}) {
  const w = coloredTip.width;
  if (stampOff.width < w) { stampOff.width = w; stampOff.height = w; }
  stampCtx.clearRect(0, 0, stampOff.width, stampOff.height);

  stampCtx.globalCompositeOperation = 'source-over';
  stampCtx.globalAlpha = 1;
  stampCtx.drawImage(coloredTip, 0, 0);

  if (grain && grainDepth > 0) {
    // textureScale: tamanho do grain DENTRO da shape (raw 0..16).
    // Valor 1 = grain 1:1; valor 8 = grain 8x maior (textura mais grossa).
    // Janela do grain a samplear: w / textureScale (menor janela = grain
    // parece maior depois do stretch pra cobrir o stamp).
    const sampleW = Math.max(1, Math.round(w / textureScale));
    let gx = Math.floor(grainOffX) % grain.width;
    let gy = Math.floor(grainOffY) % grain.height;
    if (gx < 0) gx += grain.width;
    if (gy < 0) gy += grain.height;
    stampCtx.globalAlpha = grainDepth;
    stampCtx.globalCompositeOperation = 'multiply';
    const sw = Math.min(sampleW, grain.width - gx);
    const sh = Math.min(sampleW, grain.height - gy);
    stampCtx.drawImage(grain, gx, gy, sw, sh, 0, 0, w, w);
    // remover excesso fora do alpha do tip
    stampCtx.globalAlpha = 1;
    stampCtx.globalCompositeOperation = 'destination-in';
    stampCtx.drawImage(coloredTip, 0, 0);
  }
  stampCtx.globalCompositeOperation = 'source-over';
  return w;
}
