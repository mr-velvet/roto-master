// Frames Editor · Brush engine.
// Arquivo de fachada (re-exporta o que o resto do app consome).
// A engine de fato vive em 3 módulos menores:
//
//   fe_brush_loader.js — loadBrush + prep de assets (tip, grain)
//   fe_brush_stamp.js  — render de um stamp único (tip-colorido + grain)
//   fe_brush_stroke.js — interpolação de pontos + createBrushStroke
//
// Manter esta fachada permite que páginas existentes (brush-test, futuro
// editor de tirinha) importem 'fe_brush.js' sem saber da estrutura interna.

export { loadBrush } from './fe_brush_loader.js';
export { createBrushStroke } from './fe_brush_stroke.js';
