// Hidrología mínima (planet-gen §2b): relleno de depresiones por prioridad desde el mar; cada celda
// de tierra desagua hacia la que la alcanzó, así todo camino río abajo termina en el mar. Lo
// rellenado son lagos. El caudal es la escorrentía acumulada (lluvia menos evapotranspiración
// por Budyko) y un río es la celda que junta mucho más que su propia lluvia.

import { PI } from "../../core/index.ts";
import type { Grid } from "./grid.ts";
import { MinHeap } from "./heap.ts";

export interface Hydrology {
  /** La celda a la que desagua cada celda de tierra; -1 en el mar. */
  readonly flowTo: Int32Array;
  /** Caudal medio que pasa por la celda, m³/s (solo tierra). */
  readonly discharge: Float64Array;
  readonly river: Uint8Array;
  readonly lake: Uint8Array;
  /** Profundidad del lago, m. */
  readonly lakeDepth: Float64Array;
}

const SECONDS_PER_YEAR = 31_557_600;
/** Una depresión menos honda se llena de sedimento y queda como cuenca, no como lago. */
const LAKE_MIN_DEPTH = 120;
const RIVER_BASIN = 10;

/** Una cuenca bajo el nivel del mar es océano solo si mide al menos esta fracción de la mayor. */
const OCEAN_MIN_SHARE = 0.1;

/**
 * Los mares epicontinentales (celdas bajo el nivel del mar sin conexión con un océano) son lagos
 * endorreicos: siguen evaporando, así que el clima los trata como agua, pero la biota y los ríos
 * los ven como lago y no como mar. Su profundidad es lo que les falta para el nivel del mar.
 */
function markInlandSeas(
  grid: Grid,
  elevation: Float64Array,
  lake: Uint8Array,
  lakeDepth: Float64Array,
): void {
  const comp = new Int32Array(grid.size).fill(-1);
  const members: number[][] = [];
  for (let c = 0; c < grid.size; c++) {
    if (comp[c] !== -1 || (elevation[c] as number) > 0) continue;
    const cells = [c];
    comp[c] = members.length;
    for (let i = 0; i < cells.length; i++) {
      for (const m of grid.neighborsOf(cells[i] as number)) {
        if (comp[m] !== -1 || (elevation[m] as number) > 0) continue;
        comp[m] = members.length;
        cells.push(m);
      }
    }
    members.push(cells);
  }
  const biggest = members.reduce((n, cells) => Math.max(n, cells.length), 0);
  for (const cells of members) {
    if (cells.length >= OCEAN_MIN_SHARE * biggest) continue;
    for (const c of cells) {
      lake[c] = 1;
      lakeDepth[c] = -(elevation[c] as number);
    }
  }
}

export function hydrology(
  grid: Grid,
  elevation: Float64Array,
  precipitation: Float64Array,
  temperature: Float64Array,
  radiusKm: number,
): Hydrology {
  const size = grid.size;
  const flowTo = new Int32Array(size).fill(-1);
  const filled = new Float64Array(size);
  const seen = new Uint8Array(size);
  const order: number[] = [];
  const heap = new MinHeap();
  for (let c = 0; c < size; c++) {
    if ((elevation[c] as number) <= 0) {
      seen[c] = 1;
      filled[c] = elevation[c] as number;
      heap.push(elevation[c] as number, c);
    }
  }
  while (heap.size > 0) {
    const [level, c] = heap.pop();
    if ((elevation[c] as number) > 0) order.push(c);
    for (const m of grid.neighborsOf(c)) {
      if (seen[m]) continue;
      seen[m] = 1;
      const f = Math.max(elevation[m] as number, level);
      filled[m] = f;
      flowTo[m] = c;
      heap.push(f, m);
    }
  }

  const lake = new Uint8Array(size);
  const lakeDepth = new Float64Array(size);
  markInlandSeas(grid, elevation, lake, lakeDepth);
  for (const c of order) {
    const depth = (filled[c] as number) - (elevation[c] as number);
    if (depth > LAKE_MIN_DEPTH) {
      lake[c] = 1;
      lakeDepth[c] = depth;
    }
  }

  // Escorrentía y caudal acumulado, de las nacientes al mar.
  const sphereKm2 = 4 * PI * radiusKm * radiusKm;
  const own = new Float64Array(size);
  const discharge = new Float64Array(size);
  let ownSum = 0;
  for (const c of order) {
    const P = precipitation[c] as number;
    const pet = Math.max(0, 50 * (temperature[c] as number));
    const runoffMm = P + pet > 0 ? (P * P) / (P + pet) : 0;
    const q = ((runoffMm / 1000) * (grid.areas[c] as number) * sphereKm2 * 1e6) / SECONDS_PER_YEAR;
    own[c] = q;
    discharge[c] = q;
    ownSum += q;
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const c = order[i] as number;
    const to = flowTo[c] as number;
    if (to >= 0 && (elevation[to] as number) > 0) {
      discharge[to] = (discharge[to] as number) + (discharge[c] as number);
    }
  }

  const meanOwn = order.length > 0 ? ownSum / order.length : 0;
  const river = new Uint8Array(size);
  for (const c of order) {
    // En el nivel 0 solo los ríos grandes (una cuenca de ~10 celdas); los chicos, en el nivel 1.
    if (
      (discharge[c] as number) >= RIVER_BASIN * meanOwn &&
      (discharge[c] as number) >= 2 * (own[c] as number)
    ) {
      river[c] = 1;
    }
  }
  return { flowTo, discharge, river, lake, lakeDepth };
}
