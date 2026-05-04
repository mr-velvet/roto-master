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

module.exports = { uploadBuffer, deleteFile, copyObject, BUCKET, PUBLIC_URL_PREFIX };
