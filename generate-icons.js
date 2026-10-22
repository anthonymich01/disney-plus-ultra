const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c >>> 0;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(size) {
  const width = size;
  const height = size;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.46;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Deep Disney Blue gradient to Cyan Ultra glow
        const t = (x + y) / (width + height);
        let r = Math.round(15 * (1 - t) + 0 * t);
        let g = Math.round(60 * (1 - t) + 180 * t);
        let b = Math.round(230 * (1 - t) + 255 * t);
        let a = 255;

        // Anti-aliased outer edge
        if (dist > radius - 1) {
          a = Math.round(255 * (radius - dist));
        }

        // Draw a golden/cyan play triangle in center
        // Triangle points: (cx - r*0.35, cy - r*0.45) to (cx + r*0.5, cy) to (cx - r*0.35, cy + r*0.45)
        const triLeft = cx - radius * 0.35;
        const triRight = cx + radius * 0.45;
        const triHalfHeight = radius * 0.45;

        if (x >= triLeft && x <= triRight) {
          const prog = (x - triLeft) / (triRight - triLeft);
          const topY = cy - triHalfHeight * (1 - prog);
          const botY = cy + triHalfHeight * (1 - prog);

          if (y >= topY && y <= botY) {
            // White with cyan tint for the play button
            r = 255;
            g = 255;
            b = 255;
          }
        }

        // Add a stylized "U" arc (Ultra) around the top right
        const arcDist = Math.abs(dist - radius * 0.8);
        if (arcDist < Math.max(1, size * 0.04) && (dx > 0 || dy < 0)) {
          r = 0;
          g = 210;
          b = 255;
        }

        rawData[pxOffset] = r;
        rawData[pxOffset + 1] = g;
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = a;
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach(size => {
  const pngBuf = createPng(size);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, pngBuf);
  console.log(`Generated ${outPath} (${pngBuf.length} bytes)`);
});
