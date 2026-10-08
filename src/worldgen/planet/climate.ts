// Clima medio (planet-gen §3, etapa 3): temperatura por latitud, inclinación y altura (6.5 °C/km);
// corrientes oceánicas simplificadas en las costas (cálidas en las costas este de los subtrópicos,
// frías con afloramiento en las oeste, deriva cálida en las oeste de latitudes altas); bandas de
// viento (alisios, oestes, polares); humedad que el viento lleva desde el mar y que la lluvia y
// las montañas gastan, así aparecen las sombras de lluvia sin pintarlas.

import { exp, PI, pow, sqrt } from "../../core/index.ts";
import { cross, dot, type Grid, normalize, type Vec3 } from "./grid.ts";
import { fbm } from "./noise.ts";
import { blur } from "./tectonics.ts";

export interface Climate {
  /** Media anual, °C. */
  readonly temperature: Float64Array;
  /** Diferencia entre el mes más cálido y el más frío, °C. */
  readonly seasonalRange: Float64Array;
  /** mm por año. */
  readonly precipitation: Float64Array;
  /** Corriente costera: 1 cálida, -1 fría, 0 ninguna. */
  readonly current: Int8Array;
  /** Viento dominante en la base tangente (este, norte). */
  readonly windEast: Float64Array;
  readonly windNorth: Float64Array;
}

export interface ClimateOptions {
  readonly axialTiltDeg: number;
  readonly kmPerHop: number;
  readonly noiseSeed: number;
}

const DEG = 180 / PI;

/** Base tangente (este, norte) en un punto; en los polos, un este cualquiera fijo. */
export function tangentBasis(p: Vec3): { east: Vec3; north: Vec3 } {
  const l = sqrt(p[0] * p[0] + p[1] * p[1]);
  const east: Vec3 = l < 1e-12 ? [1, 0, 0] : [-p[1] / l, p[0] / l, 0];
  return { east, north: cross(p, east) };
}

/** Lluvia por pasada según la latitud: la ZCIT llueve, las altas subtropicales no. */
function rainRate(latAbsDeg: number): number {
  const pts: readonly (readonly [number, number])[] = [
    [0, 0.3],
    [10, 0.24],
    [20, 0.08],
    [30, 0.05],
    [40, 0.2],
    [55, 0.22],
    [70, 0.1],
    [90, 0.05],
  ];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i] as readonly [number, number];
    const [x0, y0] = pts[i - 1] as readonly [number, number];
    if (latAbsDeg <= x1) return y0 + ((y1 - y0) * (latAbsDeg - x0)) / (x1 - x0);
  }
  return 0.05;
}

export function climate(grid: Grid, elevation: Float64Array, opts: ClimateOptions): Climate {
  const size = grid.size;
  const ns = opts.noiseSeed;
  const tiltF = opts.axialTiltDeg / 23.44;
  const ocean = (c: number) => (elevation[c] as number) <= 0;

  // --- Distancia al mar (continentalidad) ----------------------------------------------------
  const hops = new Int32Array(size).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < size; c++) {
    if (ocean(c)) {
      hops[c] = 0;
      frontier.push(c);
    }
  }
  for (let h = 1; frontier.length > 0; h++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const m of grid.neighborsOf(c)) {
        if (hops[m] !== -1) continue;
        hops[m] = h;
        next.push(m);
      }
    }
    frontier = next;
  }

  // --- Corrientes en las costas --------------------------------------------------------------
  let dT: Float64Array<ArrayBuffer> = new Float64Array(size);
  let dP: Float64Array<ArrayBuffer> = new Float64Array(size); // logaritmo natural del multiplicador de lluvia
  const current = new Int8Array(size);
  for (let c = 0; c < size; c++) {
    const p = grid.at(c);
    const { east } = tangentBasis(p);
    let side = 0;
    let coastal = false;
    for (const m of grid.neighborsOf(c)) {
      if (ocean(m) === ocean(c)) continue;
      coastal = true;
      const q = grid.at(m);
      side += (q[0] - p[0]) * east[0] + (q[1] - p[1]) * east[1] + (q[2] - p[2]) * east[2];
    }
    if (!coastal) continue;
    // +1: costa este de un continente (el mar al este de la tierra); -1: costa oeste.
    const coast = ocean(c) ? (side < 0 ? 1 : -1) : side > 0 ? 1 : -1;
    const lat = Math.abs(grid.lat[c] as number) * DEG;
    if (coast === 1 && lat >= 10 && lat <= 50) {
      current[c] = 1;
      dT[c] = 5;
      dP[c] = 0.55;
    } else if (coast === -1 && lat >= 15 && lat <= 40) {
      current[c] = -1;
      dT[c] = -6;
      dP[c] = -1.4;
    } else if (coast === -1 && lat >= 45 && lat <= 70) {
      current[c] = 1;
      dT[c] = 6;
      dP[c] = 0.45;
    }
  }
  for (let k = 0; k < 3; k++) {
    dT = blur(grid, dT);
    dP = blur(grid, dP);
  }

  // --- Temperatura -----------------------------------------------------------------------------
  const grad = Math.min(70, Math.max(25, 55 - 0.4 * (opts.axialTiltDeg - 23.44)));
  const temperature = new Float64Array(size);
  const seasonalRange = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const p = grid.at(c);
    const s = p[2];
    const e = Math.max(0, elevation[c] as number);
    temperature[c] =
      28 -
      grad * s * s * (0.55 + 0.45 * s * s) +
      (dT[c] as number) -
      (6.5 * e) / 1000 +
      1.5 * fbm(ns + 61, p, 5, 3);
    const cont = 1 - exp(-((hops[c] as number) * opts.kmPerHop) / 1000);
    seasonalRange[c] = ocean(c)
      ? (2 + 12 * Math.abs(s)) * tiltF * 0.6
      : (4 + 30 * Math.abs(s) * (0.4 + 0.6 * cont)) * tiltF;
  }

  // --- Viento ------------------------------------------------------------------------------------
  const windEast = new Float64Array(size);
  const windNorth = new Float64Array(size);
  const wind: Vec3[] = [];
  for (let c = 0; c < size; c++) {
    const p = grid.at(c);
    const latDeg = (grid.lat[c] as number) * DEG;
    const a = Math.abs(latDeg);
    const sign = latDeg >= 0 ? 1 : -1;
    let ue: number;
    let un: number;
    if (a < 30) {
      ue = -1; // alisios: del este, hacia el ecuador
      un = -sign * 0.3;
    } else if (a < 60) {
      ue = 1; // oestes: del oeste, hacia el polo
      un = sign * 0.3;
    } else {
      ue = -1;
      un = -sign * 0.2;
    }
    windEast[c] = ue;
    windNorth[c] = un;
    const { east, north } = tangentBasis(p);
    wind.push([
      ue * east[0] + un * north[0],
      ue * east[1] + un * north[1],
      ue * east[2] + un * north[2],
    ]);
  }

  // Qué parte de lo que sale de cada celda va a cada vecina (alineada con grid.neighbors).
  const share = new Float64Array(grid.neighbors.length);
  const incoming = new Float64Array(size);
  const upwindElev = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const p = grid.at(c);
    const w = wind[c] as Vec3;
    const start = grid.offsets[c] as number;
    const end = grid.offsets[c + 1] as number;
    let total = 0;
    for (let k = start; k < end; k++) {
      const q = grid.at(grid.neighbors[k] as number);
      const s = Math.max(0, dot(w, normalize(q[0] - p[0], q[1] - p[1], q[2] - p[2])));
      share[k] = s;
      total += s;
    }
    for (let k = start; k < end; k++) {
      const s = total > 0 ? (share[k] as number) / total : 0;
      share[k] = s;
      const m = grid.neighbors[k] as number;
      incoming[m] = (incoming[m] as number) + s;
      upwindElev[m] = (upwindElev[m] as number) + s * Math.max(0, elevation[c] as number);
    }
  }
  for (let c = 0; c < size; c++) {
    const w = incoming[c] as number;
    upwindElev[c] = w > 0 ? (upwindElev[c] as number) / w : Math.max(0, elevation[c] as number);
  }

  // --- Humedad y lluvia --------------------------------------------------------------------------
  const ADVECT = 0.85;
  const hopScale = opts.kmPerHop / 175;
  // Fracción de la lluvia sobre tierra que sale del aire; el resto vuelve (evapotranspiración,
  // lagos, ríos). Calibrado en 8 seeds: media en tierra 500-640 mm y 23-32 % de tierra seca.
  const LAND_RAIN_LOSS = 0.04;
  const passes = Math.max(30, 3 * grid.lattice.n);
  const average = Math.max(5, Math.floor(passes / 6));
  const rate = new Float64Array(size);
  const evap = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const lat = Math.abs(grid.lat[c] as number) * DEG;
    const orog = ocean(c)
      ? 0
      : (0.6 * Math.max(0, (elevation[c] as number) - (upwindElev[c] as number))) / 1000;
    // Las tasas son por 175 km de recorrido: con celdas de otro tamaño se componen.
    rate[c] = Math.min(0.95, 1 - pow(1 - rainRate(lat), hopScale) + orog);
    evap[c] = Math.min(1.1, Math.max(0.05, ((temperature[c] as number) + 10) / 40));
  }
  let M = new Float64Array(size);
  const rain = new Float64Array(size);
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float64Array(size);
    for (let c = 0; c < size; c++) {
      const m = M[c] as number;
      if (m === 0) continue;
      const start = grid.offsets[c] as number;
      const end = grid.offsets[c + 1] as number;
      let moved = 0;
      for (let k = start; k < end; k++) {
        const part = ADVECT * m * (share[k] as number);
        const to = grid.neighbors[k] as number;
        next[to] = (next[to] as number) + part;
        moved += part;
      }
      next[c] = (next[c] as number) + m - moved;
    }
    const counting = pass >= passes - average;
    for (let c = 0; c < size; c++) {
      let m = next[c] as number;
      if (ocean(c)) m = Math.max(m, evap[c] as number);
      const r = (rate[c] as number) * m;
      // Sobre tierra, parte de la lluvia vuelve al aire (evapotranspiración): se recicla.
      next[c] = m - (ocean(c) ? r : LAND_RAIN_LOSS * r);
      if (counting) rain[c] = (rain[c] as number) + r / average;
    }
    M = next;
  }

  const precipitation = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const mult = exp(dP[c] as number) * (1 + 0.15 * fbm(ns + 67, grid.at(c), 6, 3));
    precipitation[c] = Math.max(0, ((rain[c] as number) * 9000 * mult) / hopScale);
  }

  return { temperature, seasonalRange, precipitation, current, windEast, windNorth };
}
