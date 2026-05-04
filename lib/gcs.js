// Helper de upload pro Google Cloud Storage.
// Bucket: didlu-imagestore. URL pública: https://st.did.lu/<path>.
// Auth via env GCS_SERVICE_ACCOUNT (JSON inline da plataforma did.lu).

const { Storage } = require('@google-cloud/storage');

const BUCKET = 'didlu-imagestore';
const PUBLIC_URL_PREFIX = 'https://st.did.lu';

let storage = null;
function getStorage() {
  if (storage) return storage;
  const raw = process.env.GCS_SERVICE_ACCOUNT;
  if (raw) {
    const credentials = JSON.parse(raw);
    storage = new Storage({ credentials, projectId: credentials.project_id });
  } else {
    storage = new Storage();
  }
  return storage;
}

async function uploadBuffer(path, buffer, contentType) {
  const bucket = getStorage().bucket(BUCKET);
  const file = bucket.file(path);
  await file.save(buffer, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  return {
    gcs_path: path,
    gcs_url: `${PUBLIC_URL_PREFIX}/${path}`,
  };
}

async function deleteFile(path) {
  try {
    await getStorage().bucket(BUCKET).file(path).delete();
  } catch (e) {
    if (e.code !== 404) throw e;
  }
}

// Copia objeto dentro do mesmo bucket (server-side; não baixa o blob).
async function copyObject(srcPath, dstPath) {
  const bucket = getStorage().bucket(BUCKET);
  await bucket.file(srcPath).copy(bucket.file(dstPath));
  return {
    gcs_path: dstPath,
    gcs_url: `${PUBLIC_URL_PREFIX}/${dstPath}`,
  };
}

// Baixa de uma URL externa e sobe pro GCS. Usado pra imagens/vídeos do fal.ai
// que ficam em URLs temporárias.
async function uploadFromUrl(srcUrl, dstPath, fallbackContentType) {
  const r = await fetch(srcUrl);
  if (!r.ok) throw new Error(`uploadFromUrl: GET ${srcUrl} → ${r.status}`);
  const ab = await r.arrayBuffer();
  const buffer = Buffer.from(ab);
  const contentType = r.headers.get('content-type') || fallbackContentType || 'application/octet-stream';
  return uploadBuffer(dstPath, buffer, contentType);
}

module.exports = { uploadBuffer, deleteFile, copyObject, uploadFromUrl, BUCKET, PUBLIC_URL_PREFIX };
