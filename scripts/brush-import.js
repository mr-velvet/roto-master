#!/usr/bin/env node
// Importa um .brushset do Procreate (ou um .brush solto) e gera o catálogo
// próprio do Frames Editor em public/brushes/.
//
// Uso:
//   node scripts/brush-import.js <arquivo.brushset> [<destino>]
//
// Mapeamento Procreate → schema próprio (achatado):
//   name                          → name
//   plotSpacing                   → spacing             (fração do tipSize, 0-1)
//   paintSize / minSize / maxSize → sizeMin, sizeMax    (escala Procreate; UI normaliza)
//   paintOpacity / min / max      → opacityMin, opacityMax
//   shapeScatter                  → scatter             (0 = sem; >0 = deslocamento radial)
//   shapeRotation                 → rotationRandom      (1 = totalmente aleatória; 0 = fixa)
//   shapeAngle                    → shapeAngle          (radianos, ângulo base do tip)
//   dynamicsJitterSize/Opacity    → jitterSize, jitterOpacity
//   dynamicsPressureSize/Opacity  → pressureSize, pressureOpacity
//   grainDepth                    → grainDepth
//   grainOrientation              → grainMovement       (0='space', 1='follows')
//   Shape.png                     → tip.png
//   Grain.png                     → ../shared/grain-<hash>.png (deduplicado)
//   Thumbnail (QuickLook)         → thumb.png

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const bplist = require('bplist-parser');

const SRC = process.argv[2];
const DEST = process.argv[3] || path.resolve(__dirname, '..', 'public', 'brushes');

if (!SRC) {
  console.error('uso: node scripts/brush-import.js <arquivo.brushset> [<destino>]');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error('arquivo não encontrado:', SRC);
  process.exit(1);
}

function safeName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Resolve UID do NSKeyedArchiver dentro do array de objetos.
// Versão "simples" — só tipos primitivos.
function resolveArchive(archive) {
  const objs = archive[0]['$objects'];
  const resolve = (v) => {
    if (v && typeof v === 'object' && v.UID !== undefined) return objs[v.UID];
    return v;
  };
  const params = objs[1];
  const result = {};
  for (const k of Object.keys(params)) {
    const v = resolve(params[k]);
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      result[k] = v;
    }
  }
  return result;
}

// Resolve TODOS os campos do brush, incluindo curvas e dicts. Usado pra gerar
// a seção __source/__notImplemented do meta.json — pra você ver o que está
// no arquivo original que ainda não estamos consumindo.
function resolveArchiveFull(archive) {
  const objs = archive[0]['$objects'];
  const resolve = (v) => {
    if (v && typeof v === 'object' && v.UID !== undefined) return objs[v.UID];
    return v;
  };
  const params = objs[1];
  const result = {};
  for (const k of Object.keys(params)) {
    if (k === '$class') continue;
    const v = resolve(params[k]);
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      result[k] = v;
    } else if (v && typeof v === 'object' && 'points' in v) {
      // Curva: extrai pontos como [[x,y], ...]
      const pts = resolve(v.points);
      if (pts && pts['NS.objects']) {
        const arr = pts['NS.objects'].map((ref) => {
          const s = resolve(ref);
          if (typeof s !== 'string') return null;
          const m = s.match(/\{\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)\s*\}/);
          return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
        }).filter(Boolean);
        result[k] = { __type: 'curve', points: arr };
      }
    } else {
      // outros tipos (NSData, NSDate, dicts complexos): marca tipo
      result[k] = { __type: 'opaque', repr: String(v).slice(0, 80) };
    }
  }
  return result;
}

// Campos Procreate que o `mapParams` consome (lê e usa no nosso schema).
// Cuidado: se mexer no mapParams, atualiza aqui.
const IMPLEMENTED_FIELDS = new Set([
  'name',
  'plotSpacing',
  'minSize', 'maxSize',
  'minOpacity', 'maxOpacity',
  'paintSize', 'paintOpacity',
  'shapeScatter',
  // shapeRotation: NÃO consumido (significado pra 0..1 sem fonte pública)
  'shapeAngle',
  'shapeRoundness',
  'dynamicsJitterSize', 'dynamicsJitterOpacity',
  'dynamicsPressureSize', 'dynamicsPressureOpacity',
  'grainDepth',
  'grainOrientation',  // OBS: significado incerto segundo catálogo
  'blendMode',
  // v6: novas features
  'textureScale',
  'plotJitter',
  'dynamicsFalloff',
  'taperStartLength', 'taperEndLength',
  'taperSize', 'taperOpacity', 'taperPressure',
  'dynamicsTiltSize', 'dynamicsTiltOpacity',
  'dynamicsTiltAngle', 'dynamicsTiltCompression',
]);

// Defaults observados em "Pencils by Sko4" — 148 campos que têm o mesmo
// valor em todos os 20 brushes. Carregado como tabela de referência.
let DEFAULTS_SKO4 = {};
try {
  const defPath = path.resolve(__dirname, 'brush-defaults-sko4.json');
  DEFAULTS_SKO4 = JSON.parse(fs.readFileSync(defPath, 'utf8'));
} catch (e) {
  console.warn('aviso: scripts/brush-defaults-sko4.json não encontrado — todos os campos não-implementados vão pra __notImplemented');
}

// Defaults adicionais inferidos pelo significado do campo. Vários campos
// têm semântica "0 = inativo" mas variam entre brushes (uns ativam, outros
// não), então não entram no SKO4 all-same. Lista esses defaults óbvios
// pra reduzir o ruído no __notImplemented — só sobram features REAIS.
const SEMANTIC_DEFAULTS = {
  // Stroke path
  plotJitter: 0,
  dynamicsFalloff: 0,
  // Stabilization
  plotSmoothing: 0,
  plotMovingAverageStabilization: 0,
  dynamicsPressureSmoothing: 0,
  // Taper
  taperStartLength: 0, taperEndLength: 0,
  taperOpacity: 0, taperSize: 0, taperPressure: 1, taperShape: 0,
  pencilTaperStartLength: 0, pencilTaperEndLength: 0,
  pencilTaperOpacity: 0, pencilTaperSize: 0, pencilTaperShape: 0,
  // Shape
  shapeCount: 0, shapeCountJitter: 0,
  shapeFlipXJitter: false, shapeFlipYJitter: false,
  shapeRotation: 0,
  // Tilt — esses só importam em Apple Pencil
  dynamicsTiltSize: 0, dynamicsTiltOpacity: 0, dynamicsTiltAngle: 0,
  dynamicsTiltBleed: 0, dynamicsTiltCompression: 0,
  dynamicsTiltBrightness: 0, dynamicsTiltSaturation: 0,
  dynamicsTiltHue: 0, dynamicsTiltGradation: 0, dynamicsTiltSecondaryColor: 0,
  // Pressure secundário
  dynamicsPressureBleed: 0, dynamicsPressureMix: 0,
  // Wet edges / smudge
  wetEdgesAmount: 0, smudgeSize: 0, smudgeOpacity: 0,
  // Speed
  dynamicsSpeedSize: 0, dynamicsSpeedOpacity: 0,
  // Rendering exotic
  renderingRecursiveMixing: false,
  // Transfer
  dynamicsPressureOpacityTransfer: 1, // 1 = sem efeito conforme decoder
  // Smudge accumulation default: 0.75 nos Sko4 — provavelmente default real
  dynamicsSmudgeAccumulation: 0.75,
};

// Campos que são metadata ou estado interno do Procreate, não features
// renderizadas. Ignorar do __notImplemented (não tem o que implementar).
const NOISE_FIELDS = new Set([
  'creationDate', 'authorName', 'importedFromABR',
  'plotSpacingVersion', 'taperVersion',
  'previewSize', 'stamp', // UI-only (brush library preview)
  'color', // NSData de cor padrão — não é param de render
  // Brush Memory (presets de tamanho/opacidade salvos por usuário no app)
  'savedEraseSizes', 'savedEraseOpacities',
  'savedPaintSizes', 'savedPaintOpacities',
  'savedSmudgeSizes', 'savedSmudgeOpacities',
  // Smudge tool: o Procreate guarda params de smudge no brush ("se este
  // brush for usado pro smudge tool, com que tamanho/opacidade"). Não
  // afetam o stroke do pincel — só matéria se implementarmos smudge tool.
  'smudgeSize', 'smudgeOpacity',
  // Bundled paths apontam pro arquivo de shape/grain — não-relevantes pra render
  'bundledShapePath', 'bundledGrainPath', 'bundledHeightPath',
  'bundledMetallicPath', 'bundledRoughnessPath',
]);

// Compara valor com default (Sko4-observed OU semantic-default OU curva identidade).
function isDefault(field, value) {
  // 1) Default semântico (lista hardcoded)
  if (field in SEMANTIC_DEFAULTS) {
    const def = SEMANTIC_DEFAULTS[field];
    if (typeof value === 'number' && typeof def === 'number') {
      return Math.abs(value - def) < 1e-3;
    }
    if (value === def) return true;
  }
  // 2) Default Sko4 (observado em todos)
  const def = DEFAULTS_SKO4[field];
  if (def !== undefined) {
    if (typeof value === 'number' && typeof def === 'number') {
      return Math.abs(value - def) < 1e-6;
    }
    if (value === def) return true;
  }
  // 3) Curva identidade [(0,0),(1,1)] é o default natural pra qualquer *Curve
  if (value && value.__type === 'curve' && Array.isArray(value.points)) {
    const pts = value.points;
    if (pts.length === 2 &&
        pts[0][0] === 0 && pts[0][1] === 0 &&
        pts[1][0] === 1 && pts[1][1] === 1) {
      return true;
    }
  }
  return false;
}

// Constrói __notImplemented: campos do bplist que (a) não consumimos,
// (b) não são noise, e (c) têm valor não-default.
function buildNotImplemented(rawFull) {
  const items = [];
  for (const k of Object.keys(rawFull)) {
    if (IMPLEMENTED_FIELDS.has(k)) continue;
    if (NOISE_FIELDS.has(k)) continue;
    const v = rawFull[k];
    if (isDefault(k, v)) continue;
    items.push({ field: k, value: v });
  }
  // Ordena por nome pra leitura mais previsível
  items.sort((a, b) => a.field.localeCompare(b.field));
  return items;
}

function mapParams(p) {
  return {
    name: p.name || 'Brush',
    tip: 'tip.png',
    spacing: round(p.plotSpacing ?? 0.1),
    sizeMin: round(p.minSize ?? 0),
    sizeMax: round(p.maxSize ?? 1),
    opacityMin: round(p.minOpacity ?? 0),
    opacityMax: round(p.maxOpacity ?? 1),
    paintSize: round(p.paintSize ?? 0.5),
    paintOpacity: round(p.paintOpacity ?? 1),
    scatter: round(p.shapeScatter ?? 0),
    // shapeRotation: NÃO consumimos — significado pra 0..1 sem fonte pública;
    // tentativa anterior (multiplicar por 2π como "rotação aleatória") produzia
    // efeito visual inventado e incorreto. Permanece em __notImplemented.
    shapeAngle: round(p.shapeAngle ?? 0),
    shapeRoundness: round(p.shapeRoundness ?? 1),
    jitterSize: round(p.dynamicsJitterSize ?? 0),
    jitterOpacity: round(p.dynamicsJitterOpacity ?? 0),
    pressureSize: round(p.dynamicsPressureSize ?? 0),
    pressureOpacity: round(p.dynamicsPressureOpacity ?? 0),
    grainDepth: round(p.grainDepth ?? 0),
    grainMovement: p.grainOrientation === 1 ? 'follows' : 'space',
    blendMode: p.blendMode ?? 0,
    // Novas em v6
    textureScale: round(p.textureScale ?? 1),
    plotJitter: round(p.plotJitter ?? 0),
    dynamicsFalloff: round(p.dynamicsFalloff ?? 0),
    taperStartLength: round(p.taperStartLength ?? 0),
    taperEndLength: round(p.taperEndLength ?? 0),
    taperSize: round(p.taperSize ?? 0),
    taperOpacity: round(p.taperOpacity ?? 0),
    taperPressure: round(p.taperPressure ?? 1),
    tiltSize: round(p.dynamicsTiltSize ?? 0),
    tiltOpacity: round(p.dynamicsTiltOpacity ?? 0),
    tiltAngle: round(p.dynamicsTiltAngle ?? 0),
    tiltCompression: round(p.dynamicsTiltCompression ?? 0),
  };
}

function round(n) {
  if (typeof n !== 'number') return n;
  return Math.round(n * 10000) / 10000;
}

fs.mkdirSync(DEST, { recursive: true });
fs.mkdirSync(path.join(DEST, 'shared'), { recursive: true });

const zip = new AdmZip(SRC);
const entries = zip.getEntries();

// Agrupa por UUID
const brushes = new Map();
for (const e of entries) {
  if (e.isDirectory) continue;
  const parts = e.entryName.split('/');
  const uuid = parts[0];
  if (!/^[0-9A-F]{8}-/i.test(uuid)) continue;
  // ignora pasta "Reset/" (são os defaults; queremos o estado atual do brush)
  if (parts[1] === 'Reset') continue;
  if (!brushes.has(uuid)) brushes.set(uuid, {});
  const slot = brushes.get(uuid);
  const filename = parts[parts.length - 1];
  if (filename === 'Brush.archive') slot.archive = e.getData();
  else if (filename === 'Shape.png') slot.shape = e.getData();
  else if (filename === 'Grain.png') slot.grain = e.getData();
  else if (filename === 'Thumbnail.png' && parts.includes('QuickLook')) slot.thumb = e.getData();
}

const index = [];
const grainCache = new Map(); // hash -> filename relativo

for (const [uuid, slot] of brushes) {
  if (!slot.archive || !slot.shape) {
    console.warn('pulando', uuid, '— falta Brush.archive ou Shape.png');
    continue;
  }
  const archive = bplist.parseBuffer(slot.archive);
  const raw = resolveArchive(archive);
  const rawFull = resolveArchiveFull(archive);
  const params = mapParams(raw);
  const id = safeName(params.name) || uuid.slice(0, 8).toLowerCase();
  const dir = path.join(DEST, id);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'tip.png'), slot.shape);
  if (slot.thumb) fs.writeFileSync(path.join(dir, 'thumb.png'), slot.thumb);

  if (slot.grain && params.grainDepth > 0) {
    const hash = crypto.createHash('sha1').update(slot.grain).digest('hex').slice(0, 12);
    let grainRel = grainCache.get(hash);
    if (!grainRel) {
      const fn = `grain-${hash}.png`;
      fs.writeFileSync(path.join(DEST, 'shared', fn), slot.grain);
      grainRel = `../shared/${fn}`;
      grainCache.set(hash, grainRel);
    }
    params.grainTip = grainRel;
  }

  // Seções de debug — visível na página de teste pra você ver o que falta
  const notImpl = buildNotImplemented(rawFull);
  const fullMeta = {
    ...params,
    __implemented: [...IMPLEMENTED_FIELDS].filter((f) => f in rawFull).sort(),
    __notImplemented: notImpl,
    __source: rawFull,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(fullMeta, null, 2));
  index.push({ id, name: params.name, dir: id, thumb: slot.thumb ? 'thumb.png' : null });
  console.log('  ok', id, '·', params.name, '·', notImpl.length, 'campos não-implementados');
}

index.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(DEST, 'index.json'), JSON.stringify(index, null, 2));
console.log(`\n${index.length} brushes em ${DEST}`);
console.log(`${grainCache.size} grain(s) compartilhado(s) em ${path.join(DEST, 'shared')}`);
