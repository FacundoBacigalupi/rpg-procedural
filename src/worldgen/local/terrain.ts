// El terreno del nivel 1 (planet-gen §Grilla): relieve, agua, bosque y esencia de cada hex,
// derivados de la celda madre y sus vecinas, respetando los agregados de la madre:
// - la elevación media de los hexes es la de la celda (la corrección se concentra en el centro,
//   así el borde empalma con la celda de al lado);
// - el agua que sale por la celda es su escorrentía más la que entra de las celdas de arriba;
// - la fracción de bosque es la `treeCover` del bioma, exacta;
// - la esencia de los hexes suma exactamente la de la celda.

import { log10, Rng } from "../../core/index.ts";
import { apportion, arc, type Biome, fbm, MinHeap, type Planet } from "../planet/index.ts";
import type { LocalPatch } from "./patch.ts";

export const RIVER_M3S = 10;
export const STREAM_M3S = 0.5;
/** Una depresión menos honda se llena de sedimento: es una vega, no una laguna. */
const POND_MIN_DEPTH = 3;

export const WATER_KINDS = ["none", "stream", "river"] as const;

export interface LocalTerrain {
  /** m sobre el nivel del mar. */
  readonly elevation: Float64Array;
  /** Pendiente máxima hacia un vecino (m/m). */
  readonly slope: Float64Array;
  /** °C de media anual (la de la celda corregida por la altura). */
  readonly temperature: Float64Array;
  /** Mar abierto que entra a la celda. */
  readonly sea: Uint8Array;
  /** Hex al que desagua (índice local); -1 si el agua sale de la celda o es mar. */
  readonly flowTo: Int32Array;
  /** Caudal medio, m³/s. */
  readonly discharge: Float64Array;
  /** Índice en `WATER_KINDS`. */
  readonly water: Uint8Array;
  readonly lake: Uint8Array;
  readonly forest: Uint8Array;
  /** Esencia por hex, entera; suma la de la celda. */
  readonly essence: Float64Array;
  /** Por dónde entra el agua de cada celda de arriba: [celda, hex, caudal]. */
  readonly inflows: readonly (readonly [number, number, number])[];
  /** El caudal que sale de la celda: igual al de la celda en el planeta. */
  readonly outflow: number;
}

/** El ruido del nivel 1 es uno solo para todo el planeta: los bordes empalman. */
function localNoiseSeed(planet: Planet): number {
  return Rng.root(planet.seed).fork("worldgen", "local", "noise").u32();
}

export function localTerrain(planet: Planet, patch: LocalPatch): LocalTerrain {
  const { grid, tectonics: t, climate: cl, hydrology: hy } = planet;
  const c = patch.cell;
  const size = patch.hexes.length;
  const ns = localNoiseSeed(planet);
  const R = planet.cosmology.radiusKm;
  const hop = planet.kmPerHop / R; // radianes entre centros vecinos
  const ec = t.elevation[c] as number;
  const coarse = [c, ...grid.neighborsOf(c)];
  const outsideOf = (h: number) => patch.outside[h] as readonly number[];
  const isOceanCell = (m: number) => (t.elevation[m] as number) <= 0;

  // --- Relieve ---------------------------------------------------------------------------------
  let relief = 0;
  for (const m of coarse) relief = Math.max(relief, Math.abs((t.elevation[m] as number) - ec));
  // Una llanura (poco contraste con las vecinas) tiene lomas suaves; la montaña, quebradas.
  const amp = 15 + 0.15 * Math.min(3000, relief);
  // Detalle de 40 a 2,5 km. El ruido de valor tiene crestas alineadas con los ejes (y el agua
  // correría en rectas): se tuerce el dominio unos 20 km para que los valles serpenteen.
  const warp = 20 / R;
  const detail = (p: readonly [number, number, number]) => {
    const q: [number, number, number] = [
      p[0] + warp * fbm(ns + 1, p, R / 60, 2),
      p[1] + warp * fbm(ns + 2, p, R / 60, 2),
      p[2] + warp * fbm(ns + 3, p, R / 60, 2),
    ];
    return fbm(ns, q, R / 40, 5);
  };
  const elevation = new Float64Array(size);
  const bump = new Float64Array(size);
  let mean = 0;
  let bumpSum = 0;
  for (let h = 0; h < size; h++) {
    const p = patch.centers[h] as readonly [number, number, number];
    let w = 0;
    let e = 0;
    for (const m of coarse) {
      const k = Math.max(0, 1 - arc(p, grid.at(m)) / hop / 1.5);
      w += k * k;
      e += k * k * (t.elevation[m] as number);
    }
    const b = Math.max(0, 1 - arc(p, grid.at(c)) / hop / 0.6);
    bump[h] = b * b;
    elevation[h] = e / w + amp * detail(p);
    mean += elevation[h] as number;
    bumpSum += bump[h] as number;
  }
  // La media tiene que ser la de la celda: lo que falta se pone en el centro, no en el borde.
  const missing = (ec - mean / size) * size;
  for (let h = 0; h < size; h++) {
    elevation[h] = (elevation[h] as number) + (missing * (bump[h] as number)) / bumpSum;
  }

  const slope = new Float64Array(size);
  const temperature = new Float64Array(size);
  const run = patch.kmPerHex * 1000;
  for (let h = 0; h < size; h++) {
    let s = 0;
    for (const m of patch.neighbors[h] as readonly number[]) {
      s = Math.max(s, Math.abs((elevation[h] as number) - (elevation[m] as number)) / run);
    }
    slope[h] = s;
    temperature[h] =
      (cl.temperature[c] as number) -
      (6.5 * (Math.max(0, elevation[h] as number) - Math.max(0, ec))) / 1000;
  }

  // --- Mar: lo bajo que se conecta con una celda de mar vecina ----------------------------------
  const sea = new Uint8Array(size);
  const stack: number[] = [];
  for (let h = 0; h < size; h++) {
    if ((elevation[h] as number) > 0) continue;
    if (isOceanCell(c) || outsideOf(h).some(isOceanCell)) {
      sea[h] = 1;
      stack.push(h);
    }
  }
  while (stack.length > 0) {
    const h = stack.pop() as number;
    for (const m of patch.neighbors[h] as readonly number[]) {
      if (sea[m] || (elevation[m] as number) > 0) continue;
      sea[m] = 1;
      stack.push(m);
    }
  }

  // --- Desagüe: relleno por prioridad desde las salidas ------------------------------------------
  const down = hy.flowTo[c] as number;
  const flowTo = new Int32Array(size).fill(-1);
  const filled = new Float64Array(size);
  const seen = new Uint8Array(size);
  const heap = new MinHeap();
  const seed = (h: number) => {
    seen[h] = 1;
    filled[h] = elevation[h] as number;
    heap.push(elevation[h] as number, h);
  };
  for (let h = 0; h < size; h++) {
    if (sea[h] || (down >= 0 && outsideOf(h).includes(down))) seed(h);
  }
  if (heap.size === 0) {
    // Celda sin salida en el planeta (no pasa en tierra): desagua por su punto más bajo.
    let low = 0;
    for (let h = 1; h < size; h++) {
      if ((elevation[h] as number) < (elevation[low] as number)) low = h;
    }
    seed(low);
  }
  // El relleno da a cada hex un camino a la salida (`via`), pero en un llano rellenado esos
  // caminos son rectas paralelas. El agua baja por la pendiente de verdad hasta el fondo de su
  // hondo, y solo desde los fondos sigue el camino del relleno, que es por donde rebalsa.
  const via = new Int32Array(size).fill(-1);
  while (heap.size > 0) {
    const [level, h] = heap.pop();
    for (const m of patch.neighbors[h] as readonly number[]) {
      if (seen[m]) continue;
      seen[m] = 1;
      filled[m] = Math.max(elevation[m] as number, level);
      via[m] = h;
      heap.push(filled[m] as number, m);
    }
  }
  const spill = new Uint8Array(size);
  for (let h = 0; h < size; h++) {
    if (sea[h] || (via[h] as number) < 0) continue;
    let low = h;
    for (const m of patch.neighbors[h] as readonly number[]) {
      if ((elevation[m] as number) < (elevation[low] as number)) low = m;
    }
    if (low !== h) {
      flowTo[h] = low;
      continue;
    }
    // Un fondo: marca su camino de rebalse hasta donde ya hay otro marcado.
    for (let x = h; x >= 0 && !spill[x]; x = via[x] as number) spill[x] = 1;
  }
  for (let h = 0; h < size; h++) if (spill[h]) flowTo[h] = via[h] as number;
  // Orden de arriba hacia abajo (cada hex antes que al que desagua).
  const indegree = new Int32Array(size);
  for (let h = 0; h < size; h++) {
    const to = flowTo[h] as number;
    if (to >= 0) indegree[to] = (indegree[to] as number) + 1;
  }
  const order: number[] = [];
  for (let h = 0; h < size; h++) if (indegree[h] === 0) order.push(h);
  for (let i = 0; i < order.length; i++) {
    const to = flowTo[order[i] as number] as number;
    if (to < 0) continue;
    indegree[to] = (indegree[to] as number) - 1;
    if (indegree[to] === 0) order.push(to);
  }

  // --- Caudal: la escorrentía propia de la celda, repartida, más lo que entra de arriba ----------
  const discharge = new Float64Array(size);
  const inflows: [number, number, number][] = [];
  let upstream = 0;
  for (const u of grid.neighborsOf(c)) {
    if ((hy.flowTo[u] as number) !== c || isOceanCell(u)) continue;
    const q = hy.discharge[u] as number;
    let entry = -1;
    for (let h = 0; h < size; h++) {
      if (!outsideOf(h).includes(u)) continue;
      if (entry < 0 || (elevation[h] as number) < (elevation[entry] as number)) entry = h;
    }
    if (entry < 0) continue;
    upstream += q;
    inflows.push([u, entry, q]);
    discharge[entry] = (discharge[entry] as number) + q;
  }
  const own = isOceanCell(c) ? 0 : Math.max(0, (hy.discharge[c] as number) - upstream);
  let landHexes = 0;
  for (let h = 0; h < size; h++) if (!sea[h]) landHexes++;
  for (let h = 0; h < size; h++) {
    if (!sea[h]) discharge[h] = (discharge[h] as number) + own / landHexes;
  }
  let outflow = 0;
  for (const h of order) {
    const to = flowTo[h] as number;
    if (to < 0) outflow += discharge[h] as number;
    else discharge[to] = (discharge[to] as number) + (discharge[h] as number);
  }
  // Una laguna es un hondo que se llena hasta rebalsar: el hondo entero (lo que queda bajo el nivel
  // de rebalse) si a su fondo le llega un arroyo. Un hondo seco es un bajo, no una laguna.
  const lake = new Uint8Array(size);
  const basin = new Int32Array(size).fill(-1);
  for (let h = 0; h < size; h++) {
    if (
      sea[h] ||
      (basin[h] as number) >= 0 ||
      (filled[h] as number) - (elevation[h] as number) <= 0
    )
      continue;
    const members = [h];
    basin[h] = h;
    let fed = 0;
    for (let i = 0; i < members.length; i++) {
      const x = members[i] as number;
      fed = Math.max(fed, discharge[x] as number);
      for (const m of patch.neighbors[x] as readonly number[]) {
        if (
          (basin[m] as number) >= 0 ||
          sea[m] ||
          (filled[m] as number) - (elevation[m] as number) <= 0
        )
          continue;
        basin[m] = h;
        members.push(m);
      }
    }
    if (fed < STREAM_M3S) continue;
    for (const x of members) {
      if ((filled[x] as number) - (elevation[x] as number) > POND_MIN_DEPTH) lake[x] = 1;
    }
  }
  const water = new Uint8Array(size);
  for (let h = 0; h < size; h++) {
    if (sea[h] || lake[h]) continue;
    const q = discharge[h] as number;
    water[h] = q >= RIVER_M3S ? 2 : q >= STREAM_M3S ? 1 : 0;
  }

  // --- Bosque: la fracción del bioma, donde más le conviene ----------------------------------
  const biome = planet.biomes[planet.biome[c] as number] as Biome;
  const forest = new Uint8Array(size);
  const candidates: [number, number][] = [];
  for (let h = 0; h < size; h++) {
    if (sea[h] || lake[h] || (temperature[h] as number) < -8) continue;
    const p = patch.centers[h] as readonly [number, number, number];
    const wet = Math.min(1, log10(1 + (discharge[h] as number) / 0.05) / 2);
    const steep = Math.min(1, (slope[h] as number) / 0.4);
    candidates.push([h, fbm(ns + 101, p, R / 10, 3) + 0.4 * wet - 0.3 * steep]);
  }
  candidates.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const forestCount = Math.round(biome.treeCover * candidates.length);
  for (let i = 0; i < forestCount; i++) forest[(candidates[i] as [number, number])[0]] = 1;

  // --- Esencia: la de la celda, repartida entera -------------------------------------------------
  const weights = new Float64Array(size);
  for (let h = 0; h < size; h++) {
    const p = patch.centers[h] as readonly [number, number, number];
    const high = Math.max(0, ((elevation[h] as number) - ec) / 500);
    const wet = water[h] === 2 || lake[h] ? 0.5 : water[h] === 1 ? 0.2 : 0;
    weights[h] = Math.max(0.05, 1 + 0.5 * high + wet + 0.3 * fbm(ns + 211, p, R / 15, 3));
  }
  const essence = Float64Array.from(apportion(planet.essence.level[c] as number, weights));

  return {
    elevation,
    slope,
    temperature,
    sea,
    flowTo,
    discharge,
    water,
    lake,
    forest,
    essence,
    inflows,
    outflow,
  };
}
