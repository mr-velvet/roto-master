// Redimensionamento de PNG sem dependencias externas.
// Suporta apenas o subconjunto que precisamos: PNG RGBA 8bpp (color type 6,
// bit depth 8). Sem interlace. PNGs gerados por servicos de IA usuais
// (incluindo Fal nano-banana-pro/edit) caem nesse formato.
//
// Razao de existir: o provider de IA gera 1024x1024, mas a tirinha tem
// dimensao propria (geralmente bem menor — pixel art). Redimensionar pro
// tamanho da tirinha mantem coerencia da matriz e do canvas do editor.
// Pixel-art pede nearest-neighbor (preserva bordas duras).
//
// Se o PNG vier num formato fora do escopo (palette, grayscale, 16bpp, etc.),
// devolvemos o buffer original sem mexer — provider raramente entrega isso, e
// no pior caso a celula fica com a dimensao original (degrada elegantemente).

const zlib = require('zlib');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32 (table-based; identico ao do PNG spec).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// Decodifica PNG RGB ou RGBA 8bpp em { width, height, rgba: Uint8Array }.
// Sempre devolve em RGBA (alfa=255 quando origem for RGB).
// Filter 0 (none), 1 (sub), 2 (up), 3 (average), 4 (paeth) — todos suportados.
// Devolve null se o formato nao for o subconjunto suportado (palette, grayscale,
// 16bpp, interlace).
function decodeRGBA(buf) {
  if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_MAGIC)) return null;

  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idatParts = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset); offset += 4;
    const type = buf.slice(offset, offset + 4).toString('ascii'); offset += 4;
    const data = buf.slice(offset, offset + length); offset += length;
    offset += 4; // skip CRC

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      // Suportamos RGB (2) e RGBA (6), 8bpp, sem interlace.
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) return null;
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height) return null;

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const srcStride = width * bytesPerPixel;
  const decoded = Buffer.alloc(height * srcStride);
  let inPos = 0, outPos = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inPos++];
    for (let x = 0; x < srcStride; x++) {
      const raw = inflated[inPos++];
      const left = x >= bytesPerPixel ? decoded[outPos - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[outPos - srcStride] : 0;
      const upLeft = (x >= bytesPerPixel && y > 0) ? decoded[outPos - srcStride - bytesPerPixel] : 0;
      let pred = 0;
      switch (filter) {
        case 0: pred = 0; break;
        case 1: pred = left; break;
        case 2: pred = up; break;
        case 3: pred = (left + up) >> 1; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          pred = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
          break;
        }
      }
      decoded[outPos++] = (raw + pred) & 0xff;
    }
  }

  // Normaliza pra RGBA (alfa 255 se origem for RGB).
  if (colorType === 6) return { width, height, rgba: decoded };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < decoded.length; i += 3, j += 4) {
    rgba[j] = decoded[i];
    rgba[j + 1] = decoded[i + 1];
    rgba[j + 2] = decoded[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

// Encode RGBA 8bpp pra PNG. Filter 0 (none) em todas as linhas — simples e
// barato. Compress level 6 (default).
function encodeRGBA(width, height, rgba) {
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + stride)] = 0; // filter byte
    rgba.copy(filtered, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(filtered);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Resize nearest-neighbor (preserva bordas duras — apropriado pra pixel art).
function resizeNearest(rgba, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const srcOff = (sy * srcW + sx) * 4;
      const dstOff = (y * dstW + x) * 4;
      out[dstOff] = rgba[srcOff];
      out[dstOff + 1] = rgba[srcOff + 1];
      out[dstOff + 2] = rgba[srcOff + 2];
      out[dstOff + 3] = rgba[srcOff + 3];
    }
  }
  return out;
}

// API publica: recebe Buffer PNG, devolve { buffer, width, height } ja no
// tamanho-alvo. Se o PNG ja estiver na dimensao certa, devolve sem reencode.
// Se nao for um PNG RGBA 8bpp suportado, devolve { buffer: <original>,
// width: <original>, height: <original> } como fallback (nao quebra o fluxo).
function resizePngTo(buffer, dstW, dstH) {
  const decoded = decodeRGBA(buffer);
  if (!decoded) {
    // formato fora do escopo — devolve sem mexer.
    return { buffer, width: null, height: null };
  }
  if (decoded.width === dstW && decoded.height === dstH) {
    return { buffer, width: dstW, height: dstH };
  }
  const resized = resizeNearest(decoded.rgba, decoded.width, decoded.height, dstW, dstH);
  const reencoded = encodeRGBA(dstW, dstH, resized);
  return { buffer: reencoded, width: dstW, height: dstH };
}

module.exports = { resizePngTo, decodeRGBA, encodeRGBA, resizeNearest };
