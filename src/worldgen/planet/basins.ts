// Cuencas oceánicas y teleconexión de la oscilación (planet-gen §3, weather §1): qué cuenca toca a
// una celda de tierra y de qué lado. Puro y sin azar: sale de la geometría de la etapa de clima
// (la grilla, la elevación y la dirección de la costa), no de datos pintados. La oscilación en sí
// (período, fase, fuerza) vive en `sim/weather/oscillation.ts`; esto solo le dice a cuál cuenca
// mirar y con qué signo.

import { exp, PI } from "../../core/index.ts";
import { tangentBasis } from "./climate.ts";
import type { Grid } from "./grid.ts";

/** Alcance de la teleconexión tierra adentro, km: a esa distancia del mar queda en 1/e. */
export const TELECONNECTION_KM = 1500;
/** Fracción de superficie de una cuenca con la que oscila a pleno; las menores oscilan menos. */
export const FULL_BASIN_AREA = 0.03;
/** Piso de la fuerza de una cuenca chica, para que un mar interior no se apague del todo. */
export const MIN_BASIN_FACTOR = 0.15;

export interface OceanBasins {
  /** Por celda: índice de cuenca, o -1 si es tierra. */
  readonly basinOf: Int32Array;
  /** Por cuenca: clave estable (`basin-<celda más baja>`). */
  readonly keys: readonly string[];
  /** Por cuenca: fracción de la superficie del planeta. */
  readonly areas: readonly number[];
}

/** Las cuencas son las componentes conexas de celdas de mar (elevación <= 0). */
export function oceanBasins(grid: Grid, elevation: Float64Array): OceanBasins {
  const basinOf = new Int32Array(grid.size).fill(-1);
  const keys: string[] = [];
  const areas: number[] = [];
  for (let s = 0; s < grid.size; s++) {
    if ((elevation[s] as number) > 0 || basinOf[s] !== -1) continue;
    const id = keys.length;
    let area = 0;
    const stack = [s];
    basinOf[s] = id;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      area += grid.areas[c] as number;
      for (const m of grid.neighborsOf(c)) {
        if ((elevation[m] as number) > 0 || basinOf[m] !== -1) continue;
        basinOf[m] = id;
        stack.push(m);
      }
    }
    keys.push(`basin-${s}`);
    areas.push(area);
  }
  return { basinOf, keys, areas };
}

export interface OscillationSite {
  /** Clave de la cuenca que toca a la celda, o `null` si no hay mar al alcance. */
  readonly basin: string | null;
  /**
   * -1..1. Positivo donde el mar queda al este de la tierra (la fase cálida moja), negativo donde
   * queda al oeste (la misma fase seca): las dos orillas de una cuenca tienen signo opuesto. Cae
   * con la distancia al mar y con la latitud alta, y es chico si la cuenca es chica.
   */
  readonly teleconnection: number;
  /** Saltos de grilla hasta el mar más cercano (0 si la celda es mar). */
  readonly hops: number;
}

const NONE: OscillationSite = { basin: null, teleconnection: 0, hops: 0 };

/**
 * La cuenca y la teleconexión de una celda: busca el mar más cercano por anillos de vecinos; el
 * signo sale de hacia dónde queda (este u oeste) el mar de ese anillo. La celda de mar toca su
 * propia cuenca con teleconexión 0 (el mar abierto no tiene "orilla").
 */
export function oscillationSite(
  grid: Grid,
  basins: OceanBasins,
  kmPerHop: number,
  cell: number,
): OscillationSite {
  const own = basins.basinOf[cell] as number;
  if (own >= 0) return { basin: basins.keys[own] as string, teleconnection: 0, hops: 0 };
  const maxHops = Math.ceil((3 * TELECONNECTION_KM) / kmPerHop);
  const seen = new Set<number>([cell]);
  let ring: number[] = [cell];
  for (let h = 1; h <= maxHops; h++) {
    const next: number[] = [];
    const sea: number[] = [];
    for (const c of ring) {
      for (const m of grid.neighborsOf(c)) {
        if (seen.has(m)) continue;
        seen.add(m);
        if ((basins.basinOf[m] as number) >= 0) sea.push(m);
        else next.push(m);
      }
    }
    if (sea.length > 0) return siteFrom(grid, basins, kmPerHop, cell, sea, h);
    ring = next;
    if (ring.length === 0) break;
  }
  return NONE;
}

function siteFrom(
  grid: Grid,
  basins: OceanBasins,
  kmPerHop: number,
  cell: number,
  sea: readonly number[],
  hops: number,
): OscillationSite {
  const p = grid.at(cell);
  const { east } = tangentBasis(p);
  // Cuenca del anillo: la más grande de las que toca (la más chica es un golfo de la grande).
  let best = -1;
  let side = 0;
  for (const m of sea) {
    const b = basins.basinOf[m] as number;
    if (best === -1 || (basins.areas[b] as number) > (basins.areas[best] as number)) best = b;
  }
  for (const m of sea) {
    if (basins.basinOf[m] !== best) continue;
    const q = grid.at(m);
    side += (q[0] - p[0]) * east[0] + (q[1] - p[1]) * east[1] + (q[2] - p[2]) * east[2];
  }
  const sign = side >= 0 ? 1 : -1;
  const latDeg = (Math.abs(grid.lat[cell] as number) * 180) / PI;
  const lat = Math.min(1, Math.max(0.2, 1 - (latDeg - 50) / 30));
  const size = Math.min(
    1,
    Math.max(MIN_BASIN_FACTOR, Math.sqrt((basins.areas[best] as number) / FULL_BASIN_AREA)),
  );
  const reach = exp(-(hops * kmPerHop) / TELECONNECTION_KM);
  const mag = Math.round(reach * lat * size * 1000) / 1000;
  return { basin: basins.keys[best] as string, teleconnection: sign * mag, hops };
}
