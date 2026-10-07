// El mapa del nivel 1 alrededor de la aldea: los hexes de la celda proyectados sobre el plano
// tangente en su centro (norte arriba), cada píxel pintado con el hex más cercano.

import { cross, dot, normalize, type Vec3, type VillageSite } from "../../worldgen/index.ts";
import { type Image, makeImage, type Rgb, setPixel } from "./png.ts";
import { ELEVATION, mix, ramp } from "./render.ts";

const WATER: Rgb = [30, 60, 110];

function hexColor(site: VillageSite, h: number, farm: Set<number>, near: Set<number>): Rgb {
  const tr = site.terrain;
  if (tr.sea[h]) return WATER;
  if (tr.lake[h]) return [60, 110, 200];
  if (tr.water[h] === 2) return [20, 70, 210];
  let col = ramp(ELEVATION, tr.elevation[h] as number);
  if (tr.forest[h]) col = mix(col, near.has(h) ? [10, 70, 20] : [30, 100, 40], 0.75);
  if (farm.has(h)) col = mix(col, [225, 200, 90], 0.6);
  if (tr.water[h] === 1) col = mix(col, [70, 140, 230], 0.6);
  return col;
}

export function renderLocal(site: VillageSite, width: number): Image {
  const { patch } = site;
  const up = patch.centers.reduce<Vec3>(
    (a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
    [0, 0, 0],
  );
  const u = normalize(...up);
  const east = Math.abs(u[2]) > 0.999 ? ([1, 0, 0] as Vec3) : normalize(...cross([0, 0, 1], u));
  const north = cross(u, east);
  const xs = patch.centers.map((p) => dot(p, east));
  const ys = patch.centers.map((p) => dot(p, north));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY);
  const margin = 8;
  const scale = (width - 2 * margin) / span;
  const height = Math.ceil((maxY - minY) * scale) + 2 * margin;
  const img = makeImage(width, height);
  const best = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
  const owner = new Int32Array(width * height).fill(-1);
  // Radio de un hex en píxeles: la mitad de la distancia a un vecino, con holgura.
  const n0 = patch.neighbors[0]?.[0] ?? 0;
  const step = Math.hypot(
    (xs[0] as number) - (xs[n0] as number),
    (ys[0] as number) - (ys[n0] as number),
  );
  const r = Math.max(1, Math.ceil(step * scale * 0.75));
  for (let h = 0; h < xs.length; h++) {
    const cx = margin + ((xs[h] as number) - minX) * scale;
    const cy = margin + (maxY - (ys[h] as number)) * scale;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      if (y < 0 || y >= height) continue;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || x >= width) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d > r * r || d >= (best[y * width + x] as number)) continue;
        best[y * width + x] = d;
        owner[y * width + x] = h;
      }
    }
  }
  const farm = new Set(site.farmland);
  const near = new Set(site.forest);
  const colors = new Map<number, Rgb>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const h = owner[y * width + x] as number;
      if (h < 0) {
        setPixel(img, x, y, [16, 16, 16]);
        continue;
      }
      let col = colors.get(h);
      if (!col) {
        col = h === site.hex ? [230, 30, 30] : hexColor(site, h, farm, near);
        colors.set(h, col);
      }
      setPixel(img, x, y, col);
    }
  }
  return img;
}
