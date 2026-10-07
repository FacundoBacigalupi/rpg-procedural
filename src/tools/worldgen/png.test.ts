import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, makeImage, setPixel } from "./png.ts";

describe("encodePng", () => {
  it("firma, IHDR, CRC válidos y los píxeles vuelven al descomprimir", () => {
    const img = makeImage(3, 2);
    setPixel(img, 0, 0, [255, 0, 0]);
    setPixel(img, 2, 1, [1, 2, 3]);
    setPixel(img, 9, 9, [9, 9, 9]); // afuera: se ignora
    const png = encodePng(img);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    const chunks: { type: string; data: Uint8Array }[] = [];
    for (let o = 8; o < png.length; ) {
      const len = view.getUint32(o);
      const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
      const data = png.subarray(o + 8, o + 8 + len);
      expect(view.getUint32(o + 8 + len)).toBe(crc32(png.subarray(o + 4, o + 8 + len)));
      chunks.push({ type, data });
      o += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const [head, data] = chunks as [(typeof chunks)[0], (typeof chunks)[0]];
    const ihdr = new DataView(head.data.slice().buffer);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([3, 2]);
    const raw = inflateSync(data.data);
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
  });
});
