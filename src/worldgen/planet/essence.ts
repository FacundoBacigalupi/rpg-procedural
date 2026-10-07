// La esencia derivada de la geología (planet-gen §5, etapa 5). Nada de "qi" acá: planet-gen da
// fuentes genéricas con su causa física, y cada familia de mundo dice a qué elemento corresponde
// cada fuente (`families/`, metaphysics §2):
//   geothermal  volcanes y subducción          mineral   vetas, roca metamórfica
//   biotic      biomasa del bioma y la lluvia  hydric    ríos, lagos, costas, mar
//   sedimentary llanuras de sedimento          telluric  fallas y bordes de placa (venas)
//   celestial   cumbres altas
// La esencia baja por las pendientes unas pasadas y después se reparte el presupuesto entero del
// planeta por el método del resto mayor: la suma de las celdas es exactamente el presupuesto.

import { type EventId, exp, makeId } from "../../core/index.ts";
import type { Biome } from "./biomes.ts";
import type { Climate } from "./climate.ts";
import { apportion } from "./conserve.ts";
import type { Grid } from "./grid.ts";
import type { Hydrology } from "./hydrology.ts";
import type { Tectonics } from "./tectonics.ts";
import { ROCKS } from "./tectonics.ts";

export const ESSENCE_SOURCES = [
  "geothermal",
  "mineral",
  "biotic",
  "hydric",
  "sedimentary",
  "telluric",
  "celestial",
] as const;
export type EssenceSource = (typeof ESSENCE_SOURCES)[number];

export interface Essence {
  /** El total del planeta: suma exacta de `level`. */
  readonly budget: number;
  /** Por celda, entero. */
  readonly level: Float64Array;
  /** Por fuente (índice en `ESSENCE_SOURCES`) y celda, entero: de qué está hecho `level`. */
  readonly byKind: readonly Float64Array[];
  /** Por fuente y celda: intensidad donde nace, antes de que baje por las pendientes. */
  readonly source: readonly Float64Array[];
  /** Por fuente y celda: el evento que la causa (0 si no hay fuente). */
  readonly sourceEvent: readonly Uint32Array[];
  /** Cuánto aguanta la celda antes de que la esencia se derrame, entero. */
  readonly capacity: Float64Array;
  /** Cuánto nace en la celda por año, entero (suma `budget / 100`). */
  readonly regen: Float64Array;
}

export interface EssenceInput {
  readonly grid: Grid;
  readonly tectonics: Tectonics;
  readonly climate: Climate;
  readonly hydrology: Hydrology;
  readonly biome: Uint16Array;
  readonly biomes: readonly Biome[];
  readonly budget: number;
  readonly kmPerHop: number;
  readonly climateEvent: EventId;
  readonly hydrologyEvent: EventId;
}

const SEDIMENTARY = ROCKS.indexOf("sedimentary");

export function essence(x: EssenceInput): Essence {
  const { grid, tectonics: t, climate: cl, hydrology: hy } = x;
  const size = grid.size;
  const K = ESSENCE_SOURCES.length;
  const source = Array.from({ length: K }, () => new Float64Array(size));
  const sourceEvent = Array.from({ length: K }, () => new Uint32Array(size));
  const num = (id: EventId) => Number(id.slice(6));
  const climateN = num(x.climateEvent);
  const hydroN = num(x.hydrologyEvent);
  const set = (k: number, c: number, v: number, cause: number) => {
    if (!(v > 0)) return;
    (source[k] as Float64Array)[c] = v;
    (sourceEvent[k] as Uint32Array)[c] = cause;
  };

  for (let c = 0; c < size; c++) {
    const land = (t.elevation[c] as number) > 0;
    const plateEvent = num(t.plateEvents[t.plate[c] as number] as EventId);
    const near = (t.boundaryStress[c] as number) * exp(-(t.boundaryKm[c] as number) / 150);
    const bEvent = (t.boundaryEvent[c] as number) || plateEvent;

    // Geotermia: el volcán, o el calor de una subducción cercana.
    if (t.volcanic[c]) set(0, c, 1, t.volcanoEvent[c] as number);
    else if (t.boundary[c] === 1) set(0, c, 0.3 * near, bEvent);

    set(1, c, t.mineralization[c] as number, bEvent);

    const b = x.biomes[x.biome[c] as number] as Biome;
    if (land) {
      const wet = Math.min(1.2, (cl.precipitation[c] as number) / 1500);
      set(2, c, b.productivity * wet, climateN);
    } else set(2, c, 0.5 * b.productivity, climateN);

    let hydric: number;
    if (!land) hydric = 0.15;
    else if (hy.lake[c]) hydric = 0.6;
    else {
      let coast = 0;
      for (const m of grid.neighborsOf(c)) if ((t.elevation[m] as number) <= 0) coast = 0.2;
      hydric =
        coast + (hy.river[c] ? 0.3 * Math.min(1, (hy.discharge[c] as number) / 5000) + 0.1 : 0);
    }
    set(3, c, hydric, land ? hydroN : climateN);

    if (land && t.rock[c] === SEDIMENTARY && (t.elevation[c] as number) < 800) {
      set(4, c, 0.35, plateEvent);
    }

    set(5, c, near, bEvent);

    const peak = Math.max(0, ((t.elevation[c] as number) - 2500) / 3000);
    set(6, c, Math.min(1.5, peak), (t.upliftEvent[c] as number) || plateEvent);
  }

  // Intensidad por área: una celda grande junta más.
  const flow = source.map((s) => {
    const a = new Float64Array(size);
    for (let c = 0; c < size; c++) a[c] = (s[c] as number) * (grid.areas[c] as number);
    return a;
  });

  // Baja por las pendientes: cada pasada, el 15 % de cada celda va a sus vecinas más bajas,
  // en proporción al desnivel. Lineal y conservativo: cada fuente baja igual.
  const share = new Float64Array(grid.neighbors.length);
  const hasDown = new Uint8Array(size);
  for (let c = 0; c < size; c++) {
    const e = t.elevation[c] as number;
    const start = grid.offsets[c] as number;
    const end = grid.offsets[c + 1] as number;
    let total = 0;
    for (let k = start; k < end; k++) {
      const drop = Math.max(0, e - (t.elevation[grid.neighbors[k] as number] as number));
      share[k] = drop;
      total += drop;
    }
    if (total > 0) {
      hasDown[c] = 1;
      for (let k = start; k < end; k++) share[k] = (share[k] as number) / total;
    }
  }
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 0; k < K; k++) {
      const cur = flow[k] as Float64Array;
      const next = new Float64Array(size);
      for (let c = 0; c < size; c++) {
        const v = cur[c] as number;
        if (!hasDown[c]) {
          next[c] = (next[c] as number) + v;
          continue;
        }
        const out = 0.15 * v;
        next[c] = (next[c] as number) + v - out;
        const end = grid.offsets[c + 1] as number;
        for (let j = grid.offsets[c] as number; j < end; j++) {
          const m = grid.neighbors[j] as number;
          next[m] = (next[m] as number) + out * (share[j] as number);
        }
      }
      flow[k] = next;
    }
  }

  // Presupuesto entero: primero entre celdas, después dentro de cada celda entre fuentes.
  const weight = new Float64Array(size);
  const born = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    let w = 0;
    let s = 0;
    for (let k = 0; k < K; k++) {
      w += (flow[k] as Float64Array)[c] as number;
      s += ((source[k] as Float64Array)[c] as number) * (grid.areas[c] as number);
    }
    weight[c] = w;
    born[c] = s;
  }
  const level = Float64Array.from(apportion(x.budget, weight));
  const byKind = Array.from({ length: K }, () => new Float64Array(size));
  const parts = new Float64Array(K);
  for (let c = 0; c < size; c++) {
    const l = level[c] as number;
    if (l === 0) continue;
    for (let k = 0; k < K; k++) parts[k] = (flow[k] as Float64Array)[c] as number;
    const split = apportion(l, parts);
    for (let k = 0; k < K; k++) (byKind[k] as Float64Array)[c] = split[k] as number;
  }
  const regen = Float64Array.from(apportion(Math.floor(x.budget / 100), born));
  const capacity = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const veins =
      (t.mineralization[c] as number) +
      (t.boundaryStress[c] as number) * exp(-(t.boundaryKm[c] as number) / 150);
    capacity[c] = Math.round((level[c] as number) * (1.5 + veins));
  }
  return { budget: x.budget, level, byKind, source, sourceEvent, capacity, regen };
}

/** Las fuentes de una celda con su causa, para el inspector y los tests. */
export function essenceSources(
  e: Essence,
  c: number,
): { kind: EssenceSource; intensity: number; cause: EventId }[] {
  const out: { kind: EssenceSource; intensity: number; cause: EventId }[] = [];
  ESSENCE_SOURCES.forEach((kind, k) => {
    const v = (e.source[k] as Float64Array)[c] as number;
    if (v > 0) {
      const n = (e.sourceEvent[k] as Uint32Array)[c] as number;
      out.push({ kind, intensity: v, cause: makeId("event", n) });
    }
  });
  return out;
}
