// Ruido de valor 3D sobre la esfera, con hash entero sembrado: sin trigonometría ni `Math.random`,
// igual bit a bit en cualquier motor. Sirve para irregularidades (bordes de placas, relieve,
// rugosidad del clima), nunca como causa: el ruido da forma a lo que la física ya decidió.

import type { Vec3 } from "./grid.ts";

function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Ruido de valor en [0, 1) en el punto `p` escalado por `freq`. */
export function valueNoise(seed: number, p: Vec3, freq: number): number {
  const x = p[0] * freq;
  const y = p[1] * freq;
  const z = p[2] * freq;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const fz = smooth(z - z0);
  const s = seed | 0;
  const c = (dx: number, dy: number, dz: number) => hash3(s, x0 + dx, y0 + dy, z0 + dz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/** Suma fractal (fBm) centrada en 0, en [-1, 1] aproximadamente. */
export function fbm(seed: number, p: Vec3, freq: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(seed + o * 7919, p, f) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
