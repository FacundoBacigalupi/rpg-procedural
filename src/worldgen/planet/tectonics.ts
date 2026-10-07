// Tectónica (planet-gen §2, etapa 1): placas que crecen por inundación desde semillas, cada una con
// un polo de Euler; en los bordes, el movimiento relativo dice si convergen, divergen o se
// deslizan, y eso levanta cordilleras, abre fosas y dorsales, pone arcos volcánicos. Puntos calientes
// aparte. Al final se fija el nivel del mar para la fracción de tierra pedida y se asignan rocas.
// Cada volcán, borde y punto caliente es un evento; las celdas guardan cuál las formó.

import { type EventId, exp, makeId, type Random } from "../../core/index.ts";
import { because, eventNumber, type PlanetEvents } from "./events.ts";
import { dot, type Grid, normalize, type Vec3 } from "./grid.ts";
import { MinHeap } from "./heap.ts";
import { fbm } from "./noise.ts";

export const ROCKS = [
  "oceanic_basalt",
  "volcanic",
  "plutonic",
  "metamorphic",
  "sedimentary",
] as const;
export type Rock = (typeof ROCKS)[number];
const ROCK = Object.fromEntries(ROCKS.map((r, i) => [r, i])) as Record<Rock, number>;

export const BOUNDARY_KINDS = ["none", "convergent", "divergent", "transform"] as const;
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];

export interface Tectonics {
  readonly plateCount: number;
  readonly plate: Uint16Array;
  /** Por placa: el evento de su formación. */
  readonly plateEvents: readonly EventId[];
  /** 1 si la corteza es continental. */
  readonly continental: Uint8Array;
  /** Metros sobre el nivel del mar. */
  readonly elevation: Float64Array;
  /** Índice en `ROCKS`. */
  readonly rock: Uint8Array;
  /** El borde de placa más cercano: tipo (índice en `BOUNDARY_KINDS`), km, tensión [0, 1], evento. */
  readonly boundary: Uint8Array;
  readonly boundaryKm: Float64Array;
  readonly boundaryStress: Float64Array;
  readonly boundaryEvent: Uint32Array;
  /** 1 si hay un volcán; su evento. */
  readonly volcanic: Uint8Array;
  readonly volcanoEvent: Uint32Array;
  /** Lo que más levantó la celda (borde o punto caliente); 0 si nada. */
  readonly upliftEvent: Uint32Array;
  /** Vetas y menas [0, 1]: roca, tensión del borde y fallas. */
  readonly mineralization: Float64Array;
  readonly landFraction: number;
}

export interface TectonicsOptions {
  readonly landFraction: number;
  readonly kmPerHop: number;
  readonly noiseSeed: number;
}

const NONE = 0xffff;

export function tectonics(
  grid: Grid,
  rng: Random,
  opts: TectonicsOptions,
  ev: PlanetEvents,
  formed: EventId,
): Tectonics {
  const size = grid.size;
  const ns = opts.noiseSeed;
  const L = opts.landFraction;
  const km = opts.kmPerHop;

  // --- Placas ------------------------------------------------------------------------------
  const plateCount = Math.min(size, rng.int(8, 20));
  const seeds: number[] = [];
  while (seeds.length < plateCount) {
    const c = rng.int(0, size - 1);
    if (!seeds.includes(c)) seeds.push(c);
  }
  const rate = seeds.map(() => 0.6 + rng.float() * 0.8);
  const poles: Vec3[] = seeds.map(() => normalize(rng.normal(), rng.normal(), rng.normal()));
  const omega = seeds.map(() => 0.3 + rng.float() * 0.7);
  const leaning = seeds.map(() => (rng.chance(L) ? 0.35 : -0.35));
  const overrides = seeds.map(() => rng.float()); // en choques océano-océano, se hunde la menor
  const plateEvents = seeds.map((c, p) =>
    ev.add("planet.plate_formed", { kind: "cell", cell: grid.cellId(c) }, because(formed), {
      plate: p,
    }),
  );

  const plate = new Uint16Array(size).fill(NONE);
  const heap = new MinHeap();
  seeds.forEach((c, p) => {
    heap.push(0, c, p);
  });
  while (heap.size > 0) {
    const [cost, c, p] = heap.pop();
    if (plate[c] !== NONE) continue;
    plate[c] = p;
    for (const m of grid.neighborsOf(c)) {
      if (plate[m] !== NONE) continue;
      const rough = 1 + 0.8 * fbm(ns + 11, grid.at(m), 3, 3);
      heap.push(cost + rough / (rate[p] as number), m, p);
    }
  }

  // --- Corteza: continental donde la placa tiende a serlo, con bordes irregulares ------------
  const score = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    score[c] = (leaning[plate[c] as number] as number) + 0.5 * fbm(ns + 23, grid.at(c), 2.5, 4);
  }
  const continental = new Uint8Array(size);
  markTop(grid, score, Math.min(0.95, L + 0.08), continental);

  // --- Bordes: movimiento relativo de las placas ---------------------------------------------
  const vel = new Float64Array(size * 3);
  for (let c = 0; c < size; c++) {
    const p = plate[c] as number;
    const pole = poles[p] as Vec3;
    const w = omega[p] as number;
    const q = grid.at(c);
    vel[c * 3] = w * (pole[1] * q[2] - pole[2] * q[1]);
    vel[c * 3 + 1] = w * (pole[2] * q[0] - pole[0] * q[2]);
    vel[c * 3 + 2] = w * (pole[0] * q[1] - pole[1] * q[0]);
  }
  const onEdge = new Uint8Array(size);
  const edgeKind = new Uint8Array(size);
  const edgeStress = new Float64Array(size);
  const otherContinental = new Uint8Array(size);
  const edgeEvent = new Uint32Array(size);
  const pairEvents = new Map<string, EventId>();
  let maxStress = 0;
  for (let c = 0; c < size; c++) {
    const pc = plate[c] as number;
    const q = grid.at(c);
    let closing = 0;
    let shear = 0;
    let count = 0;
    let other = -1;
    let otherCont = 0;
    for (const m of grid.neighborsOf(c)) {
      const pm = plate[m] as number;
      if (pm === pc) continue;
      const r = grid.at(m);
      const d = normalize(r[0] - q[0], r[1] - q[1], r[2] - q[2]);
      const dv: Vec3 = [
        (vel[c * 3] as number) - (vel[m * 3] as number),
        (vel[c * 3 + 1] as number) - (vel[m * 3 + 1] as number),
        (vel[c * 3 + 2] as number) - (vel[m * 3 + 2] as number),
      ];
      const along = dot(dv, d);
      const t0 = dv[0] - along * d[0];
      const t1 = dv[1] - along * d[1];
      const t2 = dv[2] - along * d[2];
      closing += along;
      shear += Math.sqrt(t0 * t0 + t1 * t1 + t2 * t2);
      count++;
      if (other < 0 || pm < other) other = pm;
      otherCont += continental[m] as number;
    }
    if (count === 0) continue;
    closing /= count;
    shear /= count;
    onEdge[c] = 1;
    otherContinental[c] = otherCont * 2 >= count ? 1 : 0;
    const kind = Math.abs(closing) >= 0.5 * shear ? (closing > 0 ? 1 : 2) : 3; // convergente, divergente, transformante
    edgeKind[c] = kind;
    const stress = Math.sqrt(closing * closing + shear * shear);
    edgeStress[c] = stress;
    if (stress > maxStress) maxStress = stress;
    const a = Math.min(pc, other);
    const b = Math.max(pc, other);
    const key = `${a}-${b}-${kind}`;
    let e = pairEvents.get(key);
    if (!e) {
      e = ev.add(
        "planet.plate_boundary",
        { kind: "cell", cell: grid.cellId(c) },
        because(plateEvents[a] as EventId, plateEvents[b] as EventId),
        { plates: [a, b], type: BOUNDARY_KINDS[kind] },
      );
      pairEvents.set(key, e);
    }
    edgeEvent[c] = eventNumber(e);
  }
  if (maxStress > 0)
    for (let c = 0; c < size; c++) edgeStress[c] = (edgeStress[c] as number) / maxStress;

  // Distancia al borde más cercano (BFS por capas desde todas las celdas de borde).
  const source = new Int32Array(size).fill(-1);
  const hops = new Int32Array(size).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < size; c++) {
    if (onEdge[c]) {
      source[c] = c;
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
        source[m] = source[c] as number;
        next.push(m);
      }
    }
    frontier = next;
  }

  // --- Elevación base: plataformas suavizadas ------------------------------------------------
  let elevation: Float64Array<ArrayBuffer> = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const p = grid.at(c);
    elevation[c] = continental[c]
      ? 400 + 500 * fbm(ns + 31, p, 4, 4)
      : -4300 + 700 * fbm(ns + 37, p, 4, 4);
  }
  for (let pass = 0; pass < 2; pass++) elevation = blur(grid, elevation);

  // --- Bordes: cordilleras, fosas, dorsales, rifts, arcos -------------------------------------
  const boundary = new Uint8Array(size);
  const boundaryKm = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const boundaryStress = new Float64Array(size);
  const boundaryEvent = new Uint32Array(size);
  const volcanic = new Uint8Array(size);
  const volcanoCause = new Uint32Array(size);
  const uplift = new Float64Array(size);
  const upliftEvent = new Uint32Array(size);
  const raise = (c: number, amount: number, cause: number) => {
    elevation[c] = (elevation[c] as number) + amount;
    if (amount > (uplift[c] as number)) {
      uplift[c] = amount;
      upliftEvent[c] = cause;
    }
  };
  for (let c = 0; c < size; c++) {
    const s = source[c] as number;
    if (s < 0) continue;
    const h = hops[c] as number;
    const d = h * km;
    const kind = edgeKind[s] as number;
    const sigma = edgeStress[s] as number;
    const cause = edgeEvent[s] as number;
    boundary[c] = kind;
    boundaryKm[c] = d;
    boundaryStress[c] = sigma;
    boundaryEvent[c] = cause;
    const mine = continental[c] === 1;
    const other = otherContinental[s] === 1;
    const p = plate[c] as number;
    const g = (w: number) => exp(-d / w);
    if (kind === 1) {
      if (mine && other) raise(c, 4500 * sigma * g(350), cause);
      else if (mine) {
        raise(c, 3000 * sigma * g(250), cause);
        if (h >= 1 && h <= 2 && d <= 400 && sigma > 0.3) volcanic[c] = 1;
      } else if (other) raise(c, -2500 * sigma * g(100), cause);
      else {
        const otherPlate = plate[s] === p ? -1 : (plate[s] as number);
        const mineOverrides =
          otherPlate < 0 || (overrides[p] as number) > (overrides[otherPlate] as number);
        if (mineOverrides) {
          raise(c, 2500 * sigma * g(120), cause);
          if (h <= 1 && sigma > 0.3) volcanic[c] = 1;
        } else raise(c, -2500 * sigma * g(100), cause);
      }
    } else if (kind === 2) {
      if (!mine) raise(c, 2200 * sigma * g(250), cause);
      else {
        raise(c, -900 * sigma * g(120), cause);
        if (h === 0 && sigma > 0.6) volcanic[c] = 1;
      }
    } else if (kind === 3) {
      raise(c, 300 * sigma * g(80) * fbm(ns + 43, grid.at(c), 8, 2), cause);
    }
    if (volcanic[c]) volcanoCause[c] = cause;
  }

  // --- Puntos calientes ----------------------------------------------------------------------
  const hotspots = rng.int(2, 8);
  for (let k = 0; k < hotspots; k++) {
    const center = rng.int(0, size - 1);
    const e = eventNumber(
      ev.add("planet.hotspot", { kind: "cell", cell: grid.cellId(center) }, because(formed)),
    );
    const near = ring(grid, center, Math.max(1, Math.round(450 / km)));
    for (const [c, h] of near) {
      raise(c, 2500 * exp(-(h * km) / 150), e);
      if (h === 0) {
        volcanic[c] = 1;
        volcanoCause[c] = e;
      }
    }
  }

  // Detalle fino.
  for (let c = 0; c < size; c++) {
    elevation[c] = (elevation[c] as number) + 250 * fbm(ns + 41, grid.at(c), 12, 3);
  }

  // --- Nivel del mar: la fracción de tierra pedida, por área ---------------------------------
  const order = Array.from({ length: size }, (_, c) => c).sort(
    (a, b) => (elevation[b] as number) - (elevation[a] as number) || a - b,
  );
  let acc = 0;
  let k = 0;
  while (k < size - 1 && acc + (grid.areas[order[k] as number] as number) <= L) {
    acc += grid.areas[order[k] as number] as number;
    k++;
  }
  // Las k primeras son tierra: el mar queda entre la última y la siguiente.
  const hi = elevation[order[Math.max(0, k - 1)] as number] as number;
  const lo = elevation[order[k] as number] as number;
  const sea = (hi + lo) / 2;
  for (let c = 0; c < size; c++) elevation[c] = (elevation[c] as number) - sea;
  let landArea = 0;
  for (let c = 0; c < size; c++)
    if ((elevation[c] as number) > 0) landArea += grid.areas[c] as number;

  // --- Volcanes como eventos -----------------------------------------------------------------
  const volcanoEvent = new Uint32Array(size);
  for (let c = 0; c < size; c++) {
    if (!volcanic[c]) continue;
    const cause = volcanoCause[c] as number;
    volcanoEvent[c] = eventNumber(
      ev.add(
        "planet.volcano",
        { kind: "cell", cell: grid.cellId(c) },
        cause ? because(makeId("event", cause)) : because(formed),
      ),
    );
  }

  // --- Rocas y vetas -------------------------------------------------------------------------
  const rock = new Uint8Array(size);
  const mineralization = new Float64Array(size);
  const BASE: Record<Rock, number> = {
    oceanic_basalt: 0.05,
    volcanic: 0.5,
    plutonic: 0.4,
    metamorphic: 0.6,
    sedimentary: 0.1,
  };
  for (let c = 0; c < size; c++) {
    const e = elevation[c] as number;
    let r: Rock;
    if (volcanic[c]) r = "volcanic";
    else if (!continental[c] && e < 0) r = "oceanic_basalt";
    else if (boundary[c] === 1 && (boundaryKm[c] as number) < 400 && (uplift[c] as number) > 800)
      r = "metamorphic";
    else if (continental[c] && e > 1200) r = "plutonic";
    else r = "sedimentary";
    rock[c] = ROCK[r];
    const fault = (boundaryStress[c] as number) * exp(-(boundaryKm[c] as number) / 300);
    const m = BASE[r] * (0.5 + 0.5 * fault) + 0.3 * Math.max(0, fbm(ns + 53, grid.at(c), 6, 3));
    mineralization[c] = Math.min(1, Math.max(0, m));
  }

  return {
    plateCount,
    plate,
    plateEvents,
    continental,
    elevation,
    rock,
    boundary,
    boundaryKm,
    boundaryStress,
    boundaryEvent,
    volcanic,
    volcanoEvent,
    upliftEvent,
    mineralization,
    landFraction: landArea,
  };
}

/** Marca las celdas de mayor `score` hasta cubrir la fracción `fraction` del área. */
function markTop(grid: Grid, score: Float64Array, fraction: number, out: Uint8Array): void {
  const order = Array.from({ length: grid.size }, (_, c) => c).sort(
    (a, b) => (score[b] as number) - (score[a] as number) || a - b,
  );
  let acc = 0;
  for (const c of order) {
    if (acc >= fraction) break;
    out[c] = 1;
    acc += grid.areas[c] as number;
  }
}

/** Promedio de cada celda con sus vecinas (mitad y mitad). */
export function blur(grid: Grid, v: Float64Array): Float64Array<ArrayBuffer> {
  const out = new Float64Array(v.length);
  for (let c = 0; c < grid.size; c++) {
    const nb = grid.neighborsOf(c);
    let s = 0;
    for (const m of nb) s += v[m] as number;
    out[c] = 0.5 * (v[c] as number) + (0.5 * s) / nb.length;
  }
  return out;
}

/** Las celdas a `radius` saltos o menos de `center`, con su distancia, en orden de BFS. */
export function ring(grid: Grid, center: number, radius: number): [number, number][] {
  const seen = new Map<number, number>([[center, 0]]);
  let frontier = [center];
  for (let h = 1; h <= radius; h++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const m of grid.neighborsOf(c)) {
        if (seen.has(m)) continue;
        seen.set(m, h);
        next.push(m);
      }
    }
    frontier = next;
  }
  return [...seen.entries()];
}

export function rockOf(t: Tectonics, c: number): Rock {
  return ROCKS[t.rock[c] as number] as Rock;
}
