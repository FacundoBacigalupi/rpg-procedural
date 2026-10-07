// El sitio de la aldea inicial (settlements §2.1, Hito 1a): dentro de la celda que eligió
// `pickVillageSite`, el hex que mejor junta agua cerca, tierra llana para campos y bosque a
// mano. Lo que el sitio tiene son sus anclas (por qué hay gente acá), cada una con el evento del
// planeta que la causó; la fundación es un evento con esas causas. Todavía sin historia: la aldea
// no tiene quién la fundó (Fase 7), solo por qué está donde está.

import { type Event, type EventId, Rng } from "../../core/index.ts";
import { because, type Planet, PlanetEvents, pickVillageSite } from "../planet/index.ts";
import { type LocalPatch, localPatch } from "./patch.ts";
import { type LocalTerrain, localTerrain } from "./terrain.ts";

/** Un hex del nivel 1: la celda del planeta y el id canónico en la red fina. */
export interface LocalHexRef {
  readonly cell: number;
  readonly hex: number;
}

/**
 * Las anclas que puede dar el terreno (settlements §2.1, un subconjunto de `SettlementAnchor`:
 * las que vienen de la historia, como una secta o un mercado, no salen de acá).
 */
export type SiteAnchor =
  | {
      readonly kind: "water";
      readonly source: "river" | "stream" | "lake" | "sea" | "groundwater";
      /** Índice local del hex del agua. */
      readonly hex: number;
      readonly cause: EventId;
    }
  | {
      readonly kind: "farmland";
      readonly hexes: readonly number[];
      readonly yield: number;
      readonly cause: EventId;
    }
  | {
      readonly kind: "resource";
      readonly resource: "wood";
      readonly hexes: readonly number[];
      readonly cause: EventId;
    }
  | { readonly kind: "harbor"; readonly hex: number; readonly cause: EventId };

export interface VillageSite {
  readonly cell: number;
  readonly patch: LocalPatch;
  readonly terrain: LocalTerrain;
  /** Índice local del hex de la aldea. */
  readonly hex: number;
  readonly anchors: readonly SiteAnchor[];
  /** Tierra llana sin bosque alrededor: donde van los campos. */
  readonly farmland: readonly number[];
  /** El bosque cercano: el monte del que la aldea saca leña, caza y hierbas. */
  readonly forest: readonly number[];
  /** Todos los eventos (los del planeta y los nuevos), numerados en orden. */
  readonly events: readonly Event[];
  readonly forestEvent: EventId;
  readonly foundedEvent: EventId;
}

/** A cuántos hexes se camina en el día para trabajar y volver (≈ 2 km por hex). */
const FIELD_RADIUS = 3;
const FOREST_REACH = 6;
const FOREST_RADIUS = 8;

/** Distancias en hexes desde `from` hasta `max` (las de más lejos quedan en -1). */
function hops(patch: LocalPatch, from: readonly number[], max: number): Int32Array {
  const d = new Int32Array(patch.hexes.length).fill(-1);
  let frontier = [...from];
  for (const h of frontier) d[h] = 0;
  for (let k = 1; k <= max && frontier.length > 0; k++) {
    const next: number[] = [];
    for (const h of frontier) {
      for (const m of patch.neighbors[h] as readonly number[]) {
        if (d[m] !== -1) continue;
        d[m] = k;
        next.push(m);
      }
    }
    frontier = next;
  }
  return d;
}

/** Los hexes a `r` pasos o menos de `h`, ordenados; `mark` es un arreglo de trabajo reusable. */
function ball(patch: LocalPatch, h: number, r: number, mark: Int32Array): number[] {
  const out = [h];
  mark[h] = h;
  let frontier = [h];
  for (let k = 1; k <= r; k++) {
    const next: number[] = [];
    for (const x of frontier) {
      for (const m of patch.neighbors[x] as readonly number[]) {
        if (mark[m] === h) continue;
        mark[m] = h;
        next.push(m);
        out.push(m);
      }
    }
    frontier = next;
  }
  return out.sort((a, b) => a - b);
}

function eventOf(planet: Planet, kind: string): EventId {
  const e = planet.events.find((x) => x.kind === kind);
  if (!e) throw new Error(`el planeta no tiene ${kind}`);
  return e.id;
}

export function villageSite(planet: Planet, cell?: number): VillageSite {
  const root = Rng.root(planet.seed).fork("worldgen", "village");
  const c = cell ?? pickVillageSite(planet, root.fork("cell").stream());
  const patch = localPatch(planet, c);
  const tr = localTerrain(planet, patch);
  const size = patch.hexes.length;
  const climate = eventOf(planet, "planet.climate_settled");
  const drainage = eventOf(planet, "planet.drainage_formed");
  const plate = planet.tectonics.plateEvents[planet.tectonics.plate[c] as number] as EventId;

  const dry = (h: number) => !tr.sea[h] && !tr.lake[h];
  // Costa: mar adentro de la celda, o un hex del borde que da a una celda de mar.
  const oceanCell = (m: number) => (planet.tectonics.elevation[m] as number) <= 0;
  const coast = (h: number) =>
    tr.sea[h] === 1 || (patch.outside[h] as readonly number[]).some(oceanCell);
  const isWater = (h: number) => coast(h) || tr.lake[h] === 1 || (tr.water[h] as number) > 0;
  const open = (h: number) =>
    dry(h) && !tr.forest[h] && tr.water[h] !== 2 && (tr.slope[h] as number) < 0.1;
  const all = Array.from({ length: size }, (_, h) => h);
  const toWater = hops(patch, all.filter(isWater), 2);
  const toForest = hops(
    patch,
    all.filter((h) => tr.forest[h] === 1),
    FOREST_REACH,
  );

  // Puntaje de cada hex: agua cerca, llano, campos alrededor, bosque a mano.
  const score = new Float64Array(size);
  const mark = new Int32Array(size).fill(-1);
  const fields = (h: number) =>
    ball(patch, h, FIELD_RADIUS, mark).filter((m) => m !== h && open(m));
  let best = 0;
  for (let h = 0; h < size; h++) {
    if (!dry(h) || tr.water[h] === 2) continue;
    const w = toWater[h] as number;
    const water = w === -1 ? 0.15 : w <= 1 ? 1 : 0.6;
    const flat = Math.max(0, 1 - (tr.slope[h] as number) / 0.08);
    if (flat === 0) continue;
    const wood = (toForest[h] as number) === -1 ? 0.3 : 1;
    // El conteo de campos es lo caro: solo donde lo demás ya promete.
    if (water * flat * wood < 0.5 * best) continue;
    const farm = Math.min(1, fields(h).length / 12);
    score[h] = water * flat * wood * farm;
    best = Math.max(best, score[h] as number);
  }
  if (!(best > 0)) throw new RangeError(`la celda ${c} no tiene dónde poner una aldea`);
  const weights = Array.from(score, (s) => (s >= 0.8 * best ? s * s * s * s : 0));
  const hex = root.fork("hex").stream().weighted(weights);

  // Las anclas, cada una con su causa en el planeta.
  const anchors: SiteAnchor[] = [];
  const near = hops(patch, [hex], 2);
  const waterHexes = all.filter((h) => near[h] !== -1 && isWater(h));
  waterHexes.sort(
    (a, b) =>
      (near[a] as number) - (near[b] as number) ||
      (tr.discharge[b] as number) - (tr.discharge[a] as number) ||
      a - b,
  );
  const w0 = waterHexes[0];
  if (w0 === undefined) anchors.push({ kind: "water", source: "groundwater", hex, cause: climate });
  else {
    const source = tr.lake[w0]
      ? "lake"
      : tr.water[w0] === 2
        ? "river"
        : tr.water[w0] === 1
          ? "stream"
          : "sea";
    anchors.push({ kind: "water", source, hex: w0, cause: drainage });
  }
  const seaHex = waterHexes.find((h) => coast(h) && (near[h] as number) <= 1);
  if (seaHex !== undefined) anchors.push({ kind: "harbor", hex: seaHex, cause: plate });
  const farmland = fields(hex);
  const productivity = planet.biomes[planet.biome[c] as number]?.productivity ?? 0;
  anchors.push({
    kind: "farmland",
    hexes: farmland,
    yield: Math.round(farmland.length * productivity * 100) / 100,
    cause: climate,
  });

  // El bosque cercano: el macizo de bosque más cercano, hasta FOREST_RADIUS de la aldea.
  const reach = hops(patch, [hex], FOREST_RADIUS);
  let first = -1;
  for (let h = 0; h < size; h++) {
    if (!tr.forest[h] || reach[h] === -1) continue;
    if (first < 0 || (reach[h] as number) < (reach[first] as number)) first = h;
  }
  const forest: number[] = [];
  if (first >= 0) {
    const inForest = new Uint8Array(size);
    inForest[first] = 1;
    const stack = [first];
    while (stack.length > 0) {
      const h = stack.pop() as number;
      forest.push(h);
      for (const m of patch.neighbors[h] as readonly number[]) {
        if (inForest[m] || !tr.forest[m] || reach[m] === -1) continue;
        inForest[m] = 1;
        stack.push(m);
      }
    }
    forest.sort((a, b) => a - b);
    anchors.push({ kind: "resource", resource: "wood", hexes: forest, cause: climate });
  }

  const ev = new PlanetEvents(planet.events);
  const place = { kind: "cell", cell: planet.grid.cellId(c) } as const;
  const forestEvent = ev.add("ecology.forest_established", place, because(climate), {
    hexes: forest.length,
  });
  const anchorCauses = [...new Set(anchors.map((a) => a.cause))].sort();
  const foundedEvent = ev.add(
    "settlement.founded",
    place,
    because(...(forest.length > 0 ? [...anchorCauses, forestEvent] : anchorCauses)),
    { hex: patch.hexes[hex], anchors: anchors.map((a) => a.kind) },
  );
  return {
    cell: c,
    patch,
    terrain: tr,
    hex,
    anchors,
    farmland,
    forest,
    events: ev.list,
    forestEvent,
    foundedEvent,
  };
}

/** El hex de la aldea como referencia estable (celda + id canónico de la red fina). */
export function siteRef(site: VillageSite): LocalHexRef {
  return { cell: site.cell, hex: site.patch.hexes[site.hex] as number };
}
