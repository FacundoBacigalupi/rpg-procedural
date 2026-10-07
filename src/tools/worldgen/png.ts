// Un codificador PNG mínimo (RGB de 8 bits, sin filtro): lo justo para mirar los mapas del
// planeta sin depender de nada. `node:zlib` hace el deflate y el CRC.

import { crc32, deflateSync } from "node:zlib";

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGB, fila por fila, `width * height * 3` bytes. */
  readonly rgb: Uint8Array;
}

export function makeImage(width: number, height: number): Image {
  return { width, height, rgb: new Uint8Array(width * height * 3) };
}

export function setPixel(img: Image, x: number, y: number, [r, g, b]: Rgb): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 3;
  img.rgb[o] = r;
  img.rgb[o + 1] = g;
  img.rgb[o + 2] = b;
}

export type Rgb = readonly [number, number, number];

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(img: Image): Uint8Array {
  if (img.rgb.length !== img.width * img.height * 3) {
    throw new RangeError("el tamaño de los datos no coincide con la imagen");
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, img.width);
  hv.setUint32(4, img.height);
  header[8] = 8; // bits por canal
  header[9] = 2; // RGB
  const stride = img.width * 3;
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    // Byte de filtro 0 (ninguno) al principio de cada fila.
    raw.set(img.rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
