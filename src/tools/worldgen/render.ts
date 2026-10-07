// Mapas equirectangulares de las capas del planeta (planet-gen §6): cada píxel busca su celda con
// `locate`, empezando por la del píxel anterior, así recorrer la imagen cuesta casi lo mismo que
// recorrer la grilla.

import { type Grid, type Planet, ROCKS } from "../../worldgen/index.ts";
import { type Image, makeImage, type Rgb, setPixel } from "./png.ts";

export const LAYERS = [
  "elevation",
  "plates",
  "rock",
  "biomes",
  "temperature",
  "precipitation",
  "rivers",
  "essence",
  "habitability",
] as const;
export type Layer = (typeof LAYERS)[number];

/** La celda de cada píxel, fila por fila. */
export function pixelCells(grid: Grid, width: number, height: number): Int32Array {
  const out = new Int32Array(width * height);
  let last = 0;
  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat);
    const z = Math.sin(lat);
    for (let x = 0; x < width; x++) {
      const lon = -Math.PI + ((x + 0.5) / width) * 2 * Math.PI;
      last = grid.locate([cl * Math.cos(lon), cl * Math.sin(lon), z], last);
      out[y * width + x] = last;
    }
  }
  return out;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const u = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

/** Rampa por tramos: `stops` ordenados por valor. */
export function ramp(stops: readonly (readonly [number, Rgb])[], v: number): Rgb {
  const first = stops[0] as readonly [number, Rgb];
  if (v <= first[0]) return first[1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i] as readonly [number, Rgb];
    const [x0, c0] = stops[i - 1] as readonly [number, Rgb];
    if (v <= x1) return mix(c0, c1, (v - x0) / (x1 - x0));
  }
  return (stops[stops.length - 1] as readonly [number, Rgb])[1];
}

function hex(color: string): Rgb {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Un color estable por índice (placas). */
function palette(i: number): Rgb {
  const h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  return [64 + (h & 127), 64 + ((h >> 8) & 127), 64 + ((h >> 16) & 127)];
}

export const ELEVATION: readonly (readonly [number, Rgb])[] = [
  [-7000, [8, 20, 60]],
  [-2000, [20, 60, 130]],
  [-1, [70, 130, 190]],
  [0, [60, 120, 60]],
  [800, [150, 170, 90]],
  [2000, [140, 110, 70]],
  [4000, [200, 200, 200]],
  [6500, [255, 255, 255]],
];
const TEMPERATURE: readonly (readonly [number, Rgb])[] = [
  [-40, [80, 0, 140]],
  [-15, [40, 80, 220]],
  [0, [150, 220, 255]],
  [12, [120, 200, 90]],
  [24, [250, 220, 60]],
  [35, [200, 30, 20]],
];
const PRECIPITATION: readonly (readonly [number, Rgb])[] = [
  [0, [230, 210, 160]],
  [250, [210, 200, 110]],
  [800, [110, 180, 80]],
  [2000, [30, 120, 160]],
  [4000, [20, 40, 140]],
];

/** El color de una celda en una capa. */
export function cellColor(planet: Planet, layer: Layer, c: number, maxEssence: number): Rgb {
  const t = planet.tectonics;
  const e = t.elevation[c] as number;
  const sea = e <= 0;
  const water: Rgb = [30, 60, 110];
  switch (layer) {
    case "elevation":
      return ramp(ELEVATION, e);
    case "plates": {
      const base = palette(t.plate[c] as number);
      if (t.volcanic[c]) return [255, 40, 0];
      if ((t.boundaryKm[c] as number) === 0) return mix(base, [0, 0, 0], 0.6);
      return sea ? mix(base, [0, 0, 80], 0.5) : base;
    }
    case "rock": {
      const rocks: Record<(typeof ROCKS)[number], Rgb> = {
        oceanic_basalt: [40, 50, 80],
        volcanic: [170, 40, 30],
        plutonic: [200, 150, 160],
        metamorphic: [120, 90, 150],
        sedimentary: [200, 180, 120],
      };
      return rocks[ROCKS[t.rock[c] as number] as (typeof ROCKS)[number]];
    }
    case "biomes":
      return hex(planet.biomes[planet.biome[c] as number]?.color ?? "#ff00ff");
    case "temperature":
      return ramp(TEMPERATURE, planet.climate.temperature[c] as number);
    case "precipitation": {
      const col = ramp(PRECIPITATION, planet.climate.precipitation[c] as number);
      return sea ? mix(col, water, 0.5) : col;
    }
    case "rivers": {
      if (sea) return water;
      if (planet.hydrology.lake[c]) return [60, 110, 200];
      if (planet.hydrology.river[c]) {
        const q = Math.log10(Math.max(1, planet.hydrology.discharge[c] as number));
        return mix([120, 170, 230], [10, 40, 200], q / 5);
      }
      return mix([235, 230, 215], [150, 140, 120], e / 5000);
    }
    case "essence": {
      const v = (planet.essence.level[c] as number) / maxEssence;
      const col = ramp(
        [
          [0, [0, 0, 0]],
          [0.25, [60, 20, 120]],
          [0.6, [40, 180, 200]],
          [1, [255, 255, 220]],
        ],
        Math.sqrt(v),
      );
      return sea ? mix(col, [0, 0, 30], 0.4) : col;
    }
    case "habitability":
      if (sea || planet.hydrology.lake[c]) return water;
      return ramp(
        [
          [0, [60, 40, 40]],
          [0.5, [200, 170, 60]],
          [1, [40, 220, 60]],
        ],
        planet.habitability[c] as number,
      );
  }
}

export function renderLayer(
  planet: Planet,
  layer: Layer,
  cells: Int32Array,
  width: number,
  marker?: number,
): Image {
  const height = cells.length / width;
  const img = makeImage(width, height);
  let maxEssence = 1;
  for (let c = 0; c < planet.grid.size; c++) {
    maxEssence = Math.max(maxEssence, planet.essence.level[c] as number);
  }
  for (let i = 0; i < cells.length; i++) {
    const rgb = cellColor(planet, layer, cells[i] as number, maxEssence);
    img.rgb[i * 3] = rgb[0];
    img.rgb[i * 3 + 1] = rgb[1];
    img.rgb[i * 3 + 2] = rgb[2];
  }
  if (marker !== undefined) {
    const lat = planet.grid.lat[marker] as number;
    const lon = planet.grid.lon[marker] as number;
    const x = Math.round(((lon + Math.PI) / (2 * Math.PI)) * width);
    const y = Math.round(((Math.PI / 2 - lat) / Math.PI) * height);
    for (let d = -6; d <= 6; d++) {
      for (const w of [-1, 0, 1]) {
        setPixel(img, x + d, y + w, [255, 0, 255]);
        setPixel(img, x + w, y + d, [255, 0, 255]);
      }
    }
  }
  return img;
}
