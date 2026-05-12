// Frames Editor · Brush loader.
// Carrega o JSON de meta + assets (tip, grain) e prepara canvases.

const _imgCache = new Map();
export function loadImage(url) {
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
// o canal alpha vem da luminância da tip — e o RGB é branco. Assim, ao
// colorimos com destination-in/fillRect, a cor preserva a variação tonal.
function prepTipCanvas(img) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const luma = px[i];
    px[i]     = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    px[i + 3] = luma;
  }
  cx.putImageData(data, 0, 0);
  return c;
}

// Grain do Procreate também é grayscale (preto = max effect; branco = nenhum).
// Pra multiply funcionar, deixamos como RGB grayscale (sem conversão de alpha).
function prepGrainCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

export async function loadBrush(baseUrl) {
  const meta = await fetch(`${baseUrl}/meta.json`).then((r) => r.json());
  const tipImg = await loadImage(`${baseUrl}/${meta.tip}`);
  const tip = prepTipCanvas(tipImg);
  let grain = null;
  if (meta.grainTip && meta.grainDepth > 0) {
    const grainUrl = new URL(meta.grainTip, new URL(`${baseUrl}/`, location.href)).href;
    const grainImg = await loadImage(grainUrl);
    grain = prepGrainCanvas(grainImg);
  }
  return { meta, tip, grain, baseUrl };
}
