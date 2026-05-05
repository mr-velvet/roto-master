// Estado central do app + parâmetros de efeito + presets.

export const PARAMS = {
  wave: 0, chroma: 0, scan: 0, bulge: 0, glitch: 0, feedback: 0,
  invert: 0, pixelate: 0, vignette: 0, noise: 0, hue: 0,
  tint_r: 1, tint_g: 1, tint_b: 1,
};

export const PRESETS = {
  'puro':       { wave:0, chroma:0, scan:0, bulge:0, glitch:0, feedback:0, invert:0, pixelate:0, vignette:0, noise:0, hue:0, tint_r:1, tint_g:1, tint_b:1 },
  'crt':        { wave:0, chroma:0.4, scan:0.7, bulge:0.6, glitch:0, feedback:0, invert:0, pixelate:0, vignette:0.6, noise:0.15, hue:0, tint_r:1, tint_g:1, tint_b:1 },
  'magenta':    { wave:0, chroma:0, scan:0.3, bulge:0, glitch:0, feedback:0, invert:0, pixelate:0, vignette:0.3, noise:0, hue:0, tint_r:1.0, tint_g:0.1, tint_b:0.85 },
  'amber':      { wave:0, chroma:0.2, scan:0.6, bulge:0.4, glitch:0, feedback:0, invert:0, pixelate:0, vignette:0.5, noise:0.1, hue:0, tint_r:1.0, tint_g:0.6, tint_b:0.1 },
  'pixel':      { wave:0, chroma:0, scan:0.3, bulge:0.3, glitch:0, feedback:0, invert:0, pixelate:0.7, vignette:0.4, noise:0, hue:0, tint_r:1, tint_g:1, tint_b:1 },
  'inverso':    { wave:0, chroma:0, scan:0.2, bulge:0, glitch:0, feedback:0, invert:1, pixelate:0, vignette:0.3, noise:0, hue:0, tint_r:1, tint_g:1, tint_b:1 },
};

export const SLIDERS = [
  ['wave',     'wave',          0, 1, 0.01],
  ['chroma',   'chroma aberr',  0, 1, 0.01],
  ['scan',     'scanlines',     0, 1, 0.01],
  ['bulge',    'crt bulge',     0, 1, 0.01],
  ['glitch',   'glitch bands',  0, 1, 0.01],
  ['feedback', 'feedback',      0, 1, 0.01],
  ['invert',   'inverter',      0, 1, 0.01],
  ['pixelate', 'pixelar',       0, 1, 0.01],
  ['vignette', 'vignette',      0, 1, 0.01],
  ['noise',    'ruido',         0, 1, 0.01],
  ['hue',      'hue shift',     0, 1, 0.01],
  ['tint_r',   'tinta R',       0, 2, 0.01],
  ['tint_g',   'tinta G',       0, 2, 0.01],
  ['tint_b',   'tinta B',       0, 2, 0.01],
];

// Dois modos:
//   'source'    — toca vídeo nativo, sem efeito. Marcadores in/out delimitam trecho.
//   'rotoscope' — array discreto de N frames (com efeito) sobre o trecho [in,out].
// O export sempre usa o array discreto do modo rotoscope.
export const STATE = {
  mode: 'source',        // 'source' | 'rotoscope'
  inS: 0,
  outS: 3,
  videoDurS: 0,
  fps: 12,
  scale: 1.0,
  overlay: true,
  // dados do modo rotoscope:
  frames: [],            // Uint8Array[] RGBA, dimensão dw×dh
  dw: 0, dh: 0,
  frameDurationMs: 83,
  paramsAtBuild: null,
  dirty: true,           // precisa regenerar timeline?
  // playback:
  playing: false,
  playIdx: 0,            // só usado no modo rotoscope
  playStartMs: 0,
  // marca que valores foram restaurados de edit_state (vs defaults do boot).
  // Usado pelo file_loader pra não sobrescrever in/out na carga do vídeo.
  restoredFromState: false,
};
