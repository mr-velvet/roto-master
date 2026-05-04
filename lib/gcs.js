// Helper de upload pro Google Cloud Storage.
// Bucket: didlu-imagestore. URL pública: https://st.did.lu/<path>.
// Auth via service account default na VM (env GOOGLE_APPLICATION_CREDENTIALS ou ADC).

const { Storage } = require('@google-cloud/storage');

const BUCKET = 'didlu-imagestore';
const PUBLIC_URL_PREFIX = 'https://st.did.lu';

let storage = null;
function getStorage() {
  if (!storage) storage = new Storage();
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

module.exports = { uploadBuffer, deleteFile, BUCKET, PUBLIC_URL_PREFIX };
