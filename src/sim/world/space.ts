// El espacio mínimo de la Fase 1: los lugares con nombre de la aldea (sus anclas: la aldea, los
// campos, el bosque, el agua) y en qué hex del nivel 1 (~2 km) está cada agente. Alcanza para
// moverse, para saber quién está con quién y para la luz del día. El grafo de espacios de la
// aldea (`spaces.ts`, perception §3) dice dónde está cada uno adentro del sitio; los tramos de
// viaje (travel §1) llegan después.

import type {
  CellId,
  EntityRef,
  PlaceId,
  PlaceRef,
  PlanetClock,
  SettlementId,
  SpaceKey,
  Tick,
} from "../../core/index.ts";
import { floorDiv } from "../../core/index.ts";
import { table } from "./truth.ts";

export const PLACE_KINDS = ["village", "water", "fields", "forest"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Un lugar con nombre: qué es y qué hexes cubre (índices locales del parche de la aldea). */
export interface PlaceRecord {
  readonly kind: PlaceKind;
  readonly hexes: readonly number[];
  /** Lo que se ve de él: "river", "stream", "lake", "sea", "groundwater". */
  readonly detail?: string;
}

/** Dónde está un agente: el hex del parche local y, adentro de un sitio, el espacio. */
export interface Location {
  readonly hex: number;
  /** El espacio del grafo del sitio (`spaces.ts`); sin él, el campo abierto del hex. */
  readonly space?: SpaceKey;
}

/** Los lugares son entidades (`place:n`, y el asentamiento mismo para la aldea). */
export const PLACE = table<PlaceRecord>("space.place");
export const LOCATION = table<Location>("space.location");

/** Lo que planet-gen sabe de una celda (`Climate` en la posición de la celda). */
export interface ClimateNormals {
  /** Clave estable para el RNG (el `CellId` en texto). */
  readonly cell: string;
  readonly latDeg: number;
  /** Media anual, °C. */
  readonly annualMeanC: number;
  /** Mes más cálido menos mes más frío, °C. */
  readonly seasonalRangeC: number;
  /** mm por año (agua equivalente). */
  readonly annualPrecipMm: number;
  /** Viento dominante en la base (este, norte); solo importa la dirección. */
  readonly windEast: number;
  readonly windNorth: number;
}

/**
 * El terreno local que leen los procesos: datos derivados del seed (como el contenido), no
 * estado. Lo arma `game` desde el sitio de worldgen; los tests, a mano.
 */
export interface LocalMap {
  readonly cell: CellId;
  /** Longitud en grados: la hora local sale de acá. */
  readonly lonDeg: number;
  /** Vecinos de cada hex, en orden. */
  readonly neighbors: readonly (readonly number[])[];
  /** Segundos que se tarda en cruzar cada hex caminando (terreno, pendiente, bosque). */
  readonly crossSeconds: readonly number[];
  readonly forest: readonly boolean[];
  /** Las normales de la celda: de acá sale el tiempo de cada día (`sim/weather`). */
  readonly climate: ClimateNormals;
}

/** El camino más corto en hexes de `from` a `to` (sin `from`, con `to`); vacío si son el mismo. */
export function hexPath(map: LocalMap, from: number, to: number): number[] {
  if (from === to) return [];
  const prev = new Map<number, number>([[from, from]]);
  let frontier = [from];
  while (frontier.length > 0 && !prev.has(to)) {
    const next: number[] = [];
    for (const h of frontier) {
      for (const m of map.neighbors[h] ?? []) {
        if (prev.has(m)) continue;
        prev.set(m, h);
        next.push(m);
      }
    }
    frontier = next;
  }
  if (!prev.has(to)) return [];
  const out: number[] = [];
  for (let h = to; h !== from; h = prev.get(h) as number) out.push(h);
  return out.reverse();
}

/** El hex de `hexes` más cercano a `from` en pasos (el de menor índice si empatan). */
export function nearestHex(map: LocalMap, from: number, hexes: readonly number[]): number {
  if (hexes.includes(from)) return from;
  let best = hexes[0] as number;
  let bestLen = Number.POSITIVE_INFINITY;
  for (const h of [...hexes].sort((a, b) => a - b)) {
    const len = hexPath(map, from, h).length;
    if (len > 0 && len < bestLen) {
      best = h;
      bestLen = len;
    }
  }
  return best;
}

/** La hora solar local (0-24) en `tick`, por la longitud del lugar. */
export function localHour(clock: PlanetClock, tick: Tick, lonDeg: number): number {
  const shifted = tick + Math.round((lonDeg / 360) * clock.day);
  const inDay = shifted - floorDiv(shifted, clock.day) * clock.day;
  return (inDay / clock.day) * 24;
}

/**
 * Cuánta luz hay (0-1) a una hora local: de día plena, de noche casi nada, con dos horas de
 * crepúsculo a cada lado. Sin estaciones ni luna todavía (cosmology §2, weather).
 */
export function daylight(hour: number): number {
  const NIGHT = 0.05;
  if (hour >= 7 && hour <= 17) return 1;
  if (hour > 5 && hour < 7) return NIGHT + ((1 - NIGHT) * (hour - 5)) / 2;
  if (hour > 17 && hour < 19) return NIGHT + ((1 - NIGHT) * (19 - hour)) / 2;
  return NIGHT;
}

/** El lugar con nombre que contiene `hex`, en el orden de `PLACE_KINDS` (la aldea primero). */
export function placeAt(
  places: readonly { readonly id: EntityRef; readonly place: PlaceRecord }[],
  hex: number,
): EntityRef | undefined {
  for (const kind of PLACE_KINDS) {
    const hit = places.find((p) => p.place.kind === kind && p.place.hexes.includes(hex));
    if (hit) return hit.id;
  }
  return undefined;
}

/** El `PlaceRef` de un hex para los eventos: la aldea, un lugar con nombre o la celda. */
export function placeRefOf(map: LocalMap, place: EntityRef | undefined): PlaceRef {
  if (place === undefined) return { kind: "cell", cell: map.cell };
  if (place.startsWith("settlement:")) {
    return { kind: "settlement", settlement: place as SettlementId };
  }
  return { kind: "place", place: place as PlaceId };
}
