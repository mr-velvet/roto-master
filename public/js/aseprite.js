// Writer .aseprite (validado da v1).
// Auto-contido. Depende apenas de `window.pako` (carregado via CDN).

class ByteWriter {
  constructor(initialCap = 1024) {
    this.buf = new Uint8Array(initialCap);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  _ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(this.buf.buffer);
  }
  u8(v)  { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  u16(v) { this._ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  i16(v) { this._ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  i32(v) { this._ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  bytes(arr) { this._ensure(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; }
  zeros(n) { this._ensure(n); this.pos += n; }
  str(s) {
    const enc = new TextEncoder().encode(s);
    this.u16(enc.length);
    this.bytes(enc);
  }
  placeholderU32() { const p = this.pos; this.u32(0); return p; }
  patchU32(at, val) { this.view.setUint32(at, val >>> 0, true); }
  finalize() { return this.buf.slice(0, this.pos); }
}

const ASE_MAGIC = 0xA5E0;
const FRAME_MAGIC = 0xF1FA;
const CHUNK_LAYER  = 0x2004;
const CHUNK_CEL    = 0x2005;
const CHUNK_COLOR_PROFILE = 0x2007;

const LAYER_FLAG_VISIBLE   = 1;
const LAYER_FLAG_EDITABLE  = 2;
const LAYER_FLAG_LOCK_MOVE = 4;
const LAYER_FLAG_REFERENCE = 64;
const CEL_TYPE_COMPRESSED_IMAGE = 2;

function writeChunkHeader(w, type) {
  const sizeAt = w.placeholderU32();
  w.u16(type);
  return sizeAt;
}
function patchChunkSize(w, sizeAt) {
  w.patchU32(sizeAt, w.pos - sizeAt);
}
function writeColorProfileChunk(w) {
  const sizeAt = writeChunkHeader(w, CHUNK_COLOR_PROFILE);
  w.u16(1); w.u16(0); w.u32(0); w.zeros(8);
  patchChunkSize(w, sizeAt);
}
function writeLayerChunk(w, name, flags) {
  const sizeAt = writeChunkHeader(w, CHUNK_LAYER);
  w.u16(flags); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u16(0);
  w.u8(255); w.zeros(3);
  w.str(name);
  patchChunkSize(w, sizeAt);
}
function writeCelChunk(w, layerIndex, x, y, opacity, width, height, rgbaPixels) {
  const sizeAt = writeChunkHeader(w, CHUNK_CEL);
  w.u16(layerIndex); w.i16(x); w.i16(y); w.u8(opacity);
  w.u16(CEL_TYPE_COMPRESSED_IMAGE);
  w.i16(0);  // z-index
  w.zeros(5);
  w.u16(width); w.u16(height);
  w.bytes(pako.deflate(rgbaPixels));
  patchChunkSize(w, sizeAt);
}

export function buildAseprite(frames, width, height, frameDurationMs) {
  const N = frames.length;
  const w = new ByteWriter(width * height * N + 4096);
  const fileSizeAt = w.placeholderU32();
  w.u16(ASE_MAGIC);
  w.u16(N);
  w.u16(width); w.u16(height);
  w.u16(32);
  w.u32(1);
  w.u16(frameDurationMs);
  w.u32(0); w.u32(0);
  w.u8(0); w.zeros(3);
  w.u16(0);
  w.u8(1); w.u8(1);
  w.i16(0); w.i16(0);
  w.u16(16); w.u16(16);
  w.zeros(84);
  if (w.pos !== 128) throw new Error('header size mismatch: ' + w.pos);

  const emptyPx = new Uint8Array([0, 0, 0, 0]);
  for (let i = 0; i < N; i++) {
    let chunkCount = 0;
    const frameStart = w.pos;
    const frameSizeAt = w.placeholderU32();
    w.u16(FRAME_MAGIC);
    w.u16(0); // old chunks (patch)
    w.u16(frameDurationMs);
    w.zeros(2);
    w.u32(0); // new chunks (patch)
    if (i === 0) {
      writeColorProfileChunk(w); chunkCount++;
      writeLayerChunk(w, 'ref', LAYER_FLAG_VISIBLE | LAYER_FLAG_LOCK_MOVE | LAYER_FLAG_REFERENCE); chunkCount++;
      writeLayerChunk(w, 'draw', LAYER_FLAG_VISIBLE | LAYER_FLAG_EDITABLE); chunkCount++;
    }
    writeCelChunk(w, 0, 0, 0, 255, width, height, frames[i]); chunkCount++;
    writeCelChunk(w, 1, 0, 0, 255, 1, 1, emptyPx); chunkCount++;
    const frameSize = w.pos - frameStart;
    w.patchU32(frameSizeAt, frameSize);
    w.view.setUint16(frameStart + 6, Math.min(chunkCount, 0xFFFF), true);
    w.view.setUint32(frameStart + 12, chunkCount >>> 0, true);
  }
  w.patchU32(fileSizeAt, w.pos);
  return w.finalize();
}
