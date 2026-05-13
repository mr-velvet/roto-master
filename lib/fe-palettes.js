// Paletas preset pra dithering. Cada paleta eh um array [[r,g,b], ...] de
// cores RGB 0-255. O algoritmo de dither escolhe a cor mais proxima pra cada
// pixel da imagem.
//
// 'grayscale-N' eh dinamica: N niveis igualmente espacados de preto a branco.
// 'auto-N' eh k-means da imagem em runtime (geramos no momento da aplicacao).

const PALETTES = {
  bw: {
    label: 'Preto & Branco',
    cores: [[0, 0, 0], [255, 255, 255]],
  },
  gameboy: {
    label: 'Game Boy (DMG)',
    cores: [
      [15, 56, 15],
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ],
  },
  gameboypocket: {
    label: 'Game Boy Pocket',
    cores: [
      [8, 24, 32],
      [52, 104, 86],
      [136, 192, 112],
      [224, 248, 208],
    ],
  },
  nes: {
    label: 'NES (subset)',
    cores: [
      [0, 0, 0], [124, 124, 124], [188, 188, 188], [252, 252, 252],
      [188, 0, 0], [252, 60, 24], [252, 152, 56], [252, 232, 168],
      [0, 88, 0], [60, 188, 56], [128, 208, 16],
      [0, 60, 128], [56, 116, 248], [120, 144, 252],
      [148, 0, 132], [216, 0, 100], [248, 120, 248],
    ],
  },
  cga: {
    label: 'CGA (16 cores)',
    cores: [
      [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170],
      [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
      [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255],
      [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
    ],
  },
  pico8: {
    label: 'PICO-8 (16)',
    cores: [
      [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
      [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
      [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
      [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170],
    ],
  },
  sepia: {
    label: 'Sepia',
    cores: [
      [40, 25, 15], [85, 56, 32], [128, 94, 60],
      [180, 142, 100], [220, 190, 150], [248, 232, 200],
    ],
  },
};

function paletaGrayscaleNiveis(n) {
  const niveis = Math.max(2, Math.min(64, Math.floor(n)));
  const cores = [];
  for (let i = 0; i < niveis; i++) {
    const v = Math.round((i / (niveis - 1)) * 255);
    cores.push([v, v, v]);
  }
  return { label: `Grayscale (${niveis} niveis)`, cores };
}

// k-means 1D sobre cores do PNG. Usado pela paleta 'auto-N'.
// O caller passa o buffer RGBA (sem alpha 0) e o N desejado.
function paletaAutoKMeans(rgbaBuffer, n, opts = {}) {
  const niveis = Math.max(2, Math.min(64, Math.floor(n)));
  const maxIter = opts.maxIter || 8;
  // Sample uniforme — 8000 pixels eh suficiente pra estabilidade.
  const pixels = [];
  const step = Math.max(1, Math.floor(rgbaBuffer.length / 4 / 8000));
  for (let i = 0; i < rgbaBuffer.length; i += 4 * step) {
    if (rgbaBuffer[i + 3] < 32) continue; // ignora transparencias
    pixels.push([rgbaBuffer[i], rgbaBuffer[i + 1], rgbaBuffer[i + 2]]);
  }
  if (pixels.length < niveis) {
    // imagem com poucas cores — usa as unicas + repete
    const set = Array.from(new Set(pixels.map((p) => p.join(',')))).map((s) => s.split(',').map(Number));
    while (set.length < niveis) set.push(set[set.length - 1] || [128, 128, 128]);
    return { label: `Auto (${niveis})`, cores: set.slice(0, niveis) };
  }
  // init: spread linear
  let centroides = [];
  for (let i = 0; i < niveis; i++) {
    centroides.push(pixels[Math.floor(((i + 0.5) / niveis) * pixels.length)].slice());
  }
  for (let it = 0; it < maxIter; it++) {
    const groups = Array.from({ length: niveis }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const p of pixels) {
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < niveis; i++) {
        const c = centroides[i];
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const g = groups[bestIdx];
      g.r += p[0]; g.g += p[1]; g.b += p[2]; g.n++;
    }
    let mudou = false;
    for (let i = 0; i < niveis; i++) {
      const g = groups[i];
      if (g.n === 0) continue;
      const novo = [Math.round(g.r / g.n), Math.round(g.g / g.n), Math.round(g.b / g.n)];
      if (novo[0] !== centroides[i][0] || novo[1] !== centroides[i][1] || novo[2] !== centroides[i][2]) {
        centroides[i] = novo;
        mudou = true;
      }
    }
    if (!mudou) break;
  }
  return { label: `Auto (${niveis})`, cores: centroides };
}

// Lista exposta pro frontend popular o dropdown de paletas.
const PALETTES_LIST = [
  { key: 'bw', label: PALETTES.bw.label, niveis_ajustaveis: false },
  { key: 'grayscale', label: 'Grayscale (niveis ajustaveis)', niveis_ajustaveis: true, niveis_default: 4 },
  { key: 'gameboy', label: PALETTES.gameboy.label, niveis_ajustaveis: false },
  { key: 'gameboypocket', label: PALETTES.gameboypocket.label, niveis_ajustaveis: false },
  { key: 'pico8', label: PALETTES.pico8.label, niveis_ajustaveis: false },
  { key: 'nes', label: PALETTES.nes.label, niveis_ajustaveis: false },
  { key: 'cga', label: PALETTES.cga.label, niveis_ajustaveis: false },
  { key: 'sepia', label: PALETTES.sepia.label, niveis_ajustaveis: false },
  { key: 'auto', label: 'Auto (k-means da imagem)', niveis_ajustaveis: true, niveis_default: 8 },
];

function resolverPaleta(key, niveis, rgbaBuffer) {
  if (key === 'grayscale') return paletaGrayscaleNiveis(niveis || 4);
  if (key === 'auto') return paletaAutoKMeans(rgbaBuffer, niveis || 8);
  const p = PALETTES[key];
  if (!p) throw new Error(`paleta '${key}' desconhecida`);
  return p;
}

module.exports = {
  PALETTES,
  PALETTES_LIST,
  resolverPaleta,
};
