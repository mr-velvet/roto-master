// Store: localStorage como banco. Inicializa com seed na primeira visita.
import { SEED } from './seed.js';

const KEY = 'roto.proto.v2';
const SCHEMA_VERSION = 1;

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const fresh = { schema: SCHEMA_VERSION, ...structuredClone(SEED) };
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.schema !== SCHEMA_VERSION) {
      // Schema mudou — reseta com seed novo (protótipo, sem migração).
      const fresh = { schema: SCHEMA_VERSION, ...structuredClone(SEED) };
      localStorage.setItem(KEY, JSON.stringify(fresh));
      return fresh;
    }
    return parsed;
  } catch {
    const fresh = { schema: SCHEMA_VERSION, ...structuredClone(SEED) };
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  }
}

let DB = load();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(DB));
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- read ----------
export const store = {
  user: () => DB.user,

  projects: () => DB.projects.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
  project: (id) => DB.projects.find(p => p.id === id),

  assetsByProject: (projectId) => DB.assets.filter(a => a.project_id === projectId),
  asset: (id) => DB.assets.find(a => a.id === id),

  videos: () => DB.videos.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
  video: (id) => DB.videos.find(v => v.id === id),
  videoIsPublished: (videoId) => DB.assets.some(a => a.video_id === videoId),
  videoAsset: (videoId) => DB.assets.find(a => a.video_id === videoId),

  characters: () => DB.characters,
  character: (id) => DB.characters.find(c => c.id === id),

  framings: () => DB.framings,
  framing: (id) => DB.framings.find(f => f.id === id),

  savedCameras: () => DB.saved_cameras,

  statusLabels: () => DB.status_labels,
};

// ---------- write ----------
export const mutate = {
  createProject({ name, summary }) {
    const p = {
      id: uid('p'),
      name: name || 'novo projeto',
      summary: summary || '',
      created_at: new Date().toISOString().slice(0, 10),
      cover_hue: Math.floor(Math.random() * 360)
    };
    DB.projects.unshift(p);
    persist();
    return p;
  },

  renameProject(id, name) {
    const p = DB.projects.find(x => x.id === id);
    if (p) { p.name = name; persist(); }
  },

  deleteProject(id) {
    // Cascade: remove assets do projeto (vídeos sobrevivem na workbench).
    DB.assets = DB.assets.filter(a => a.project_id !== id);
    DB.projects = DB.projects.filter(p => p.id !== id);
    persist();
  },

  // ---- vídeos ----
  createVideoUpload({ name, file_name, size_mb }) {
    const v = {
      id: uid('v'),
      name: name || file_name || 'novo vídeo',
      origin: 'uploaded',
      file_name: file_name || 'arquivo.mp4',
      size_mb: size_mb || 10,
      duration_s: 5,
      created_at: new Date().toISOString().slice(0, 10),
      hue: Math.floor(Math.random() * 360)
    };
    DB.videos.unshift(v);
    persist();
    return v;
  },

  createVideoFromCharacter({ name, character_id, framing_id, movement_prompt, duration_s }) {
    const v = {
      id: uid('v'),
      name: name || 'vídeo de personagem',
      origin: 'generated-from-character',
      character_id, framing_id,
      movement_prompt: movement_prompt || '',
      duration_s: duration_s || 5,
      created_at: new Date().toISOString().slice(0, 10),
      hue: 18
    };
    DB.videos.unshift(v);
    persist();
    return v;
  },

  duplicateVideo(id) {
    const orig = DB.videos.find(v => v.id === id);
    if (!orig) return null;
    const copy = {
      ...structuredClone(orig),
      id: uid('v'),
      name: `${orig.name} · cópia`,
      created_at: new Date().toISOString().slice(0, 10),
    };
    DB.videos.unshift(copy);
    persist();
    return copy;
  },

  renameVideo(id, name) {
    const v = DB.videos.find(x => x.id === id);
    if (v) { v.name = name; persist(); }
  },

  deleteVideo(id) {
    // Não permite deletar vídeo já publicado (asset ficaria órfão).
    if (DB.assets.some(a => a.video_id === id)) return false;
    DB.videos = DB.videos.filter(v => v.id !== id);
    persist();
    return true;
  },

  // ---- assets (publicação) ----
  publishVideoAsAsset({ video_id, project_id, asset_name }) {
    const v = DB.videos.find(x => x.id === video_id);
    if (!v) return null;
    // Já publicado? sobrescreve metadata mantendo o id do asset.
    const existing = DB.assets.find(a => a.video_id === video_id);
    if (existing) {
      existing.project_id = project_id;
      existing.name = asset_name || existing.name;
      existing.published_at = new Date().toISOString().slice(0, 10);
      persist();
      return existing;
    }
    const a = {
      id: uid('a'),
      project_id,
      video_id,
      name: asset_name || v.name,
      status: 'pendente',
      published_at: new Date().toISOString().slice(0, 10),
      frames: 16,
      fps: 12
    };
    DB.assets.unshift(a);
    persist();
    return a;
  },

  setAssetStatus(id, status) {
    const a = DB.assets.find(x => x.id === id);
    if (a) { a.status = status; persist(); }
  },

  renameAsset(id, name) {
    const a = DB.assets.find(x => x.id === id);
    if (a) { a.name = name; persist(); }
  },

  // ---- personagens ----
  createCharacter({ name, description, style, hue }) {
    const c = {
      id: uid('c'),
      name: name || 'novo personagem',
      description: description || '',
      style: style || 'semi-realista',
      hue: hue || Math.floor(Math.random() * 360),
      appearances: []
    };
    DB.characters.push(c);
    persist();
    return c;
  },

  addAppearance(character_id) {
    const c = DB.characters.find(x => x.id === character_id);
    if (!c) return null;
    const version = (c.appearances.at(-1)?.version || 0) + 1;
    const app = {
      id: uid('app'),
      version,
      favorite: c.appearances.length === 0,
      created_at: new Date().toISOString().slice(0, 10)
    };
    c.appearances.push(app);
    persist();
    return app;
  },

  renameCharacter(id, name) {
    const c = DB.characters.find(x => x.id === id);
    if (c) { c.name = name; persist(); }
  },

  // ---- enquadramentos ----
  createFraming({ name, preset_key, fov, character_ref, appearance_ref }) {
    const f = {
      id: uid('f'),
      name: name || 'novo enquadramento',
      preset_key: preset_key || 'side',
      fov: fov || 50,
      character_ref: character_ref || null,
      appearance_ref: appearance_ref || null,
      created_at: new Date().toISOString().slice(0, 10)
    };
    DB.framings.push(f);
    persist();
    return f;
  },

  // ---- saved cameras ----
  saveCamera({ name, fov, position, target }) {
    const cam = {
      id: uid('cam'),
      name: name || 'câmera salva',
      fov, position, target
    };
    DB.saved_cameras.push(cam);
    persist();
    return cam;
  },

  // ---- status labels ----
  renameStatusLabel(key, label) {
    if (DB.status_labels[key] !== undefined) {
      DB.status_labels[key] = label;
      persist();
    }
  }
};
