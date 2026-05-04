// Seed estática do protótipo. Carregada uma única vez na primeira visita.
// Depois disso, store.js usa localStorage como fonte de verdade.

// SVG procedural — gera placeholder visual único por id.
// Reaproveitado do v1 (versão simplificada).
export function svgPlaceholder(id, label, hue = 28) {
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    const cx = 20 + r(i) * 60;
    const cy = 20 + r(i + 10) * 80;
    const rad = 6 + r(i + 20) * 18;
    const op = 0.05 + r(i + 30) * 0.18;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="hsl(${hue}, 60%, 60%)" opacity="${op}"/>`);
  }
  const sx = 100, sy = 125;
  const labelText = label || id.slice(0, 6).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sx} ${sy}" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 25%, 18%)"/>
        <stop offset="100%" stop-color="hsl(${hue}, 35%, 8%)"/>
      </linearGradient>
    </defs>
    <rect width="${sx}" height="${sy}" fill="url(#g${id})"/>
    ${shapes.join('')}
    <text x="${sx/2}" y="${sy - 14}" text-anchor="middle" fill="hsl(${hue}, 50%, 70%)" font-size="6" font-family="monospace" letter-spacing="2" opacity="0.7">${labelText}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// SEED: ponto de partida pra explorar o protótipo.
export const SEED = {
  user: {
    sub: 'manu@did.lu',
    name: 'manu',
    email: 'manu@did.lu'
  },

  projects: [
    {
      id: 'p_orpheus',
      name: 'Orpheus Descending',
      summary: 'metroidvania pixel — fase 1',
      created_at: '2026-04-12',
      cover_hue: 18
    },
    {
      id: 'p_neon',
      name: 'Neon Hollow',
      summary: 'beat\'em up cyberpunk',
      created_at: '2026-04-25',
      cover_hue: 280
    },
    {
      id: 'p_field',
      name: 'Quiet Field',
      summary: 'short film loops',
      created_at: '2026-05-01',
      cover_hue: 140
    }
  ],

  // Assets vivem dentro de projetos. status: 'pendente' | 'feito' (renomeáveis depois)
  assets: [
    { id: 'a_001', project_id: 'p_orpheus', video_id: 'v_walk_orph', name: 'Cavaleiro · andar', status: 'feito',     published_at: '2026-04-20', frames: 16, fps: 12 },
    { id: 'a_002', project_id: 'p_orpheus', video_id: 'v_punch_orph', name: 'Cavaleiro · soco', status: 'pendente', published_at: '2026-04-22', frames: 12, fps: 10 },
    { id: 'a_003', project_id: 'p_orpheus', video_id: 'v_witch_idle', name: 'Bruxa · idle',     status: 'pendente', published_at: '2026-04-28', frames: 24, fps: 12 },
    { id: 'a_004', project_id: 'p_neon',    video_id: 'v_strike',     name: 'Lutador · golpe',  status: 'feito',     published_at: '2026-04-30', frames: 14, fps: 12 },
    { id: 'a_005', project_id: 'p_neon',    video_id: 'v_dash',       name: 'Lutador · dash',   status: 'pendente', published_at: '2026-05-02', frames: 10, fps: 14 },
    { id: 'a_006', project_id: 'p_field',   video_id: 'v_grass',      name: 'Capim · loop',     status: 'feito',     published_at: '2026-05-01', frames: 32, fps: 8  }
  ],

  // Vídeos vivem na workbench do usuário (não em projeto). origin = uploaded | url | generated-generic | generated-from-character
  videos: [
    { id: 'v_walk_orph',  name: 'Cavaleiro Órfico — andando',    origin: 'generated-from-character', character_id: 'c_orpheus', framing_id: 'f_lateral', movement_prompt: 'dois passos à frente, postura firme', duration_s: 5,  created_at: '2026-04-20', hue: 18 },
    { id: 'v_punch_orph', name: 'Cavaleiro Órfico — soco',        origin: 'generated-from-character', character_id: 'c_orpheus', framing_id: 'f_threequarter', movement_prompt: 'soco rápido com o braço direito', duration_s: 4, created_at: '2026-04-22', hue: 18 },
    { id: 'v_witch_idle', name: 'Bruxa Cinza — idle',             origin: 'generated-from-character', character_id: 'c_witch',   framing_id: 'f_frontal', movement_prompt: 'leve respiração, balanço sutil de cabelo', duration_s: 6, created_at: '2026-04-28', hue: 200 },
    { id: 'v_strike',     name: 'Lutador — golpe direto',         origin: 'uploaded', file_name: 'strike-ref.mp4', size_mb: 18, duration_s: 3,  created_at: '2026-04-30', hue: 280 },
    { id: 'v_dash',       name: 'Lutador — dash',                 origin: 'uploaded', file_name: 'dash.mov', size_mb: 22, duration_s: 4, created_at: '2026-05-02', hue: 280 },
    { id: 'v_grass',      name: 'Capim ao vento',                 origin: 'uploaded', file_name: 'capim.mp4', size_mb: 12, duration_s: 8, created_at: '2026-05-01', hue: 140 },
    { id: 'v_draft_walk', name: 'rascunho — caminhada lateral',   origin: 'generated-from-character', character_id: 'c_orpheus', framing_id: 'f_lateral', movement_prompt: 'caminhada lenta', duration_s: 4, created_at: '2026-05-03', hue: 18 },
    { id: 'v_draft_smoke',name: 'rascunho — fumaça',              origin: 'uploaded', file_name: 'smoke-test.mp4', size_mb: 6, duration_s: 5, created_at: '2026-05-03', hue: 60  }
  ],

  // Personagens da workbench
  characters: [
    {
      id: 'c_orpheus', name: 'Cavaleiro Órfico',
      description: 'cavaleiro órfico, armadura preta gasta, capa vermelha rasgada, cabelos brancos longos',
      style: 'semi-realista',
      hue: 18,
      appearances: [
        { id: 'app_orph_v1', version: 1, favorite: true,  created_at: '2026-04-15' },
        { id: 'app_orph_v2', version: 2, favorite: false, created_at: '2026-04-15' },
        { id: 'app_orph_v3', version: 3, favorite: false, created_at: '2026-04-16' }
      ]
    },
    {
      id: 'c_witch', name: 'Bruxa Cinza',
      description: 'bruxa idosa, manto cinza com bordados, postura curvada, olhar penetrante',
      style: 'semi-realista',
      hue: 200,
      appearances: [
        { id: 'app_witch_v1', version: 1, favorite: true, created_at: '2026-04-26' }
      ]
    },
    {
      id: 'c_fighter', name: 'Lutador Neon',
      description: 'lutador, jaqueta de couro com luzes neon, cabelo raspado dos lados',
      style: 'cartoon',
      hue: 280,
      appearances: [
        { id: 'app_fight_v1', version: 1, favorite: false, created_at: '2026-04-29' },
        { id: 'app_fight_v2', version: 2, favorite: true,  created_at: '2026-04-29' }
      ]
    }
  ],

  // Enquadramentos (recursos da workbench, reusáveis)
  framings: [
    { id: 'f_lateral',      name: 'lateral · side-scroller',  preset_key: 'side',   fov: 50, character_ref: 'c_orpheus', appearance_ref: 'app_orph_v1', created_at: '2026-04-16' },
    { id: 'f_threequarter', name: '3/4 herói',                preset_key: 'three',  fov: 45, character_ref: 'c_orpheus', appearance_ref: 'app_orph_v1', created_at: '2026-04-17' },
    { id: 'f_frontal',      name: 'frontal · retrato',        preset_key: 'front',  fov: 35, character_ref: 'c_witch',   appearance_ref: 'app_witch_v1', created_at: '2026-04-26' },
    { id: 'f_lowhero',      name: 'low-angle herói',          preset_key: 'low',    fov: 55, character_ref: 'c_fighter', appearance_ref: 'app_fight_v2', created_at: '2026-04-29' }
  ],

  // Câmeras salvas (presets do usuário)
  saved_cameras: [
    { id: 'cam_inimigo', name: 'câmera inimigo',  fov: 50, position: [3.2, 1.4, 4.0], target: [0, 1, 0] },
    { id: 'cam_boss',    name: 'boss view',       fov: 38, position: [0, 4.5, 6.0],   target: [0, 1.2, 0] },
    { id: 'cam_corredor',name: 'corredor estreito', fov: 28, position: [0, 1.6, 8.0], target: [0, 1.6, 0] }
  ],

  // Status renomeáveis (preferências do time)
  status_labels: {
    pendente: 'pendente',
    feito: 'feito'
  }
};
