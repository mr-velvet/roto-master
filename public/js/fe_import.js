// Importacao compartilhada: ArrayBuffer .aseprite -> tirinha criada no Frames
// Editor. Usado em duas situacoes:
//   1. Upload manual via Tela 1 (fe_home.js).
//   2. "Editar como tirinha" a partir de um asset (asset_modal.js).
// O fluxo eh o mesmo nos dois casos — a unica diferenca eh quem escolhe a
// origem ('upload' vs 'asset') e os metadados.

import { uploadPng, createTirinhaUpload, createTirinhaDeAsset } from './fe_api.js';
import { parseAsepriteParaFrameEditor } from './aseprite_io.js';

// Importa um .aseprite (ArrayBuffer) e cria uma tirinha. Retorna { id, total }
// ou throws.
//
// opts:
//   nome: nome da tirinha (default derivado do arquivo).
//   origem: 'upload' | 'asset'.
//   origemMeta: payload livre que vai pra fe_tirinha.origem_meta.
//   onProgress(fase, atual?, total?): callback de progresso.
//     fase: 'parse' | 'upload-celulas' | 'finalizar' | 'pronto'
//     atual/total: pra fase 'upload-celulas'
export async function importarAsepriteComoTirinha(arrayBuffer, opts = {}) {
  const {
    nome = 'Tirinha sem título',
    origem = 'upload',
    origemMeta = {},
    onProgress = () => {},
  } = opts;

  onProgress('parse');
  const estrutura = parseAsepriteParaFrameEditor(arrayBuffer);

  const total = estrutura.celulas.length;
  const celulasUploaded = [];

  for (let i = 0; i < total; i++) {
    const cel = estrutura.celulas[i];
    onProgress('upload-celulas', i, total);
    const blob = await rgbaParaPngBlob(cel.pixels_rgba, cel.largura, cel.altura);
    const { png_url, largura, altura } = await uploadPng({
      tirinhaId: '', // sem ID ainda — backend usa path provisorio
      blob,
    });
    celulasUploaded.push({
      camada_indice: cel.camada_indice,
      quadro_indice: cel.quadro_indice,
      png_url,
      largura,
      altura,
    });
  }

  onProgress('finalizar');

  const payload = {
    nome,
    largura: estrutura.largura,
    altura: estrutura.altura,
    camadas: estrutura.camadas.map((c, i) => ({ nome: c.nome, ordem: i, visivel: c.visivel })),
    quadros: estrutura.quadros.map((q, i) => ({ indice: i })),
    celulas: celulasUploaded,
  };

  let data;
  if (origem === 'asset') {
    data = await createTirinhaDeAsset({
      ...payload,
      asset_id: origemMeta.asset_id,
      tipo_aseprite: origemMeta.tipo_aseprite || 'final',
    });
  } else {
    data = await createTirinhaUpload({
      ...payload,
      origem_meta: origemMeta,
    });
  }

  onProgress('pronto', total, total);
  return { id: data.id, total };
}

async function rgbaParaPngBlob(rgba, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(w, h);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('falha ao gerar PNG'));
    }, 'image/png');
  });
}
