// El grafo de espacios de un sitio (perception §3, settlements §8): por dentro, una aldea no es un
// hex de 2 km sino calles, patios y cuartos. Cada espacio es un nodo con tamaño, luz propia y
// ruido de fondo; cada arista dice cuánto pasa de cada canal entre dos espacios (una puerta
// abierta deja ver y oír, una pared de piedra casi nada). Las distancias salen del tamaño de los
// espacios: dos personas en la misma plaza están a media plaza; de un cuarto a la calle, medio
// cuarto más media calle.
//
// Afuera de los sitios no hay grafo: el que está en un hex sin espacio está en el campo abierto
// de ese hex, que se suma como un nodo implícito unido a los espacios al aire libre del mismo hex.
//
// Por ahora el grafo es dato derivado (como `LocalMap`): lo arma `villageSpaces` desde los
// hogares. Con edificios de verdad (settlements §5) las aristas pasan a ser componentes con
// estado (una puerta que se cierra de noche) y los espacios, partes de edificios.

import type { HouseholdId, SpaceKey } from "../../core/index.ts";
import { compareStrings } from "../../core/index.ts";

export const SPACE_KINDS = ["room", "yard", "street", "square", "open"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

/** Los canales que cruzan aristas. Los demás (olfato, esencia, alma) llegan con sus fases. */
export type SpaceChannel = "sight" | "sound";

export interface SpaceNode {
  readonly key: SpaceKey;
  readonly kind: SpaceKind;
  /** El hex del parche local donde está. */
  readonly hex: number;
  /** Metros cuadrados: de acá sale la distancia típica entre dos que están adentro. */
  readonly area: number;
  readonly indoor: boolean;
  /** Fracción de la luz de afuera que entra (ventanas, techo); 1 al aire libre. */
  readonly daylight: number;
  /** Luz propia, 0-1 (el fuego del hogar, un farol), que se suma a la del día. */
  readonly lamp: number;
  /** Ruido de fondo, en las unidades de la emisión sonora (perception §3). */
  readonly noise: number;
  /** Vegetación que corta la vista adentro del espacio (1 = nada, el bosque denso ~0,05). */
  readonly clearSight: number;
  /** El hogar que vive acá, si es una casa. */
  readonly household?: HouseholdId;
}

/** Qué separa dos espacios. */
export const BARRIERS = [
  "open",
  "doorway",
  "door_closed",
  "paper_wall",
  "wood_wall",
  "stone_wall",
] as const;
export type Barrier = (typeof BARRIERS)[number];

/**
 * Cuánto de cada canal pasa por cada barrera (calibración abierta, perception §Preguntas). Una
 * puerta abierta muestra una parte del otro lado; la pared de papel deja oír y ver sombras.
 */
export const BARRIER_PASS: Readonly<Record<Barrier, Readonly<Record<SpaceChannel, number>>>> = {
  open: { sight: 1, sound: 1 },
  doorway: { sight: 0.5, sound: 0.8 },
  door_closed: { sight: 0, sound: 0.3 },
  paper_wall: { sight: 0.05, sound: 0.6 },
  wood_wall: { sight: 0, sound: 0.2 },
  stone_wall: { sight: 0, sound: 0.03 },
};

export interface SpaceEdge {
  readonly a: SpaceKey;
  readonly b: SpaceKey;
  readonly barrier: Barrier;
}

export interface SpaceGraph {
  readonly spaces: readonly SpaceNode[];
  readonly edges: readonly SpaceEdge[];
}

/** Lo que llega de un espacio a otro por un canal: cuánto pasa y cuántos metros recorre. */
export interface SpaceReach {
  readonly pass: number;
  readonly meters: number;
}

/** El lado típico de un espacio: la raíz del área. */
export function spaceSpan(space: Pick<SpaceNode, "area">): number {
  return Math.sqrt(space.area);
}

/** Área de un hex del parche local cuando no hay grafo (un hex de ~2 km entre centros). */
export const OPEN_HEX_AREA = 1_000_000;

/** La clave del campo abierto implícito de un hex. */
export function openSpaceKey(hex: number): SpaceKey {
  return `open:${hex}`;
}

/**
 * El campo abierto de un hex sin sitio: lejos de todo, sin luz propia y con poco ruido. En el
 * bosque la vista se corta enseguida.
 */
export function openSpace(hex: number, forest: boolean): SpaceNode {
  return {
    key: openSpaceKey(hex),
    kind: "open",
    hex,
    area: OPEN_HEX_AREA,
    indoor: false,
    daylight: forest ? 0.6 : 1,
    lamp: 0,
    noise: forest ? 0.04 : 0.02,
    clearSight: forest ? 0.05 : 1,
  };
}

/**
 * Lo que pasa por un canal de `from` a `to`: el camino con más paso (el producto de las barreras
 * que cruza y de la vegetación de los espacios), con los metros de ese camino. Dentro del mismo
 * espacio, media vuelta del espacio. Sin camino, `pass` 0.
 */
export function spaceReach(
  graph: SpaceGraph,
  from: SpaceKey,
  to: SpaceKey,
  channel: SpaceChannel,
): SpaceReach {
  const byKey = spaceIndex(graph);
  const start = byKey.get(from);
  const end = byKey.get(to);
  if (!start || !end) throw new RangeError(`espacio desconocido: ${start ? to : from}`);
  const sightCut = (s: SpaceNode) => (channel === "sight" ? s.clearSight : 1);
  if (from === to) {
    const half = spaceSpan(start) / 2;
    return { pass: vegetation(sightCut(start), half), meters: half };
  }

  // Dijkstra sobre el paso: el mejor producto es el camino de menor -log, pero alcanza con
  // comparar productos porque todos los factores son ≤ 1. Empates por metros y después por clave.
  const best = new Map<SpaceKey, SpaceReach>([[from, { pass: 1, meters: 0 }]]);
  const done = new Set<SpaceKey>();
  const neighbors = adjacency(graph);
  for (;;) {
    let cur: SpaceKey | undefined;
    for (const [k, r] of best) {
      if (done.has(k)) continue;
      const c = cur === undefined ? undefined : (best.get(cur) as SpaceReach);
      if (
        c === undefined ||
        r.pass > c.pass ||
        (r.pass === c.pass &&
          (r.meters < c.meters || (r.meters === c.meters && compareStrings(k, cur as string) < 0)))
      )
        cur = k;
    }
    if (cur === undefined) return { pass: 0, meters: 0 };
    const here = best.get(cur) as SpaceReach;
    if (here.pass <= 0) return { pass: 0, meters: 0 };
    if (cur === to) return here;
    done.add(cur);
    const node = byKey.get(cur) as SpaceNode;
    for (const { key, barrier } of neighbors.get(cur) ?? []) {
      if (done.has(key)) continue;
      const next = byKey.get(key) as SpaceNode;
      const leg = spaceSpan(node) / 2 + spaceSpan(next) / 2;
      const stepPass =
        BARRIER_PASS[barrier][channel] *
        vegetation(sightCut(node), spaceSpan(node) / 2) *
        vegetation(sightCut(next), spaceSpan(next) / 2);
      const cand: SpaceReach = {
        pass: here.pass * stepPass,
        meters: here.meters + leg,
      };
      const old = best.get(key);
      if (!old || cand.pass > old.pass || (cand.pass === old.pass && cand.meters < old.meters))
        best.set(key, cand);
    }
  }
}

/** Metros de vegetación de referencia: `clearSight` es lo que pasa a esta distancia. */
const VEGETATION_METERS = 20;

/** Lo que deja pasar la vegetación en `meters`: `clear` cada 20 m (1 sin vegetación). */
function vegetation(clear: number, meters: number): number {
  if (clear >= 1) return 1;
  if (clear <= 0) return 0;
  // clear^(meters/20) sin pow del motor: por cuadrados de a 20 m y lineal en el resto.
  let out = 1;
  let left = meters;
  while (left >= VEGETATION_METERS) {
    out *= clear;
    left -= VEGETATION_METERS;
    if (out < 1e-9) return 0;
  }
  return out * (1 - (1 - clear) * (left / VEGETATION_METERS));
}

function spaceIndex(graph: SpaceGraph): Map<SpaceKey, SpaceNode> {
  return new Map(graph.spaces.map((s) => [s.key, s]));
}

function adjacency(graph: SpaceGraph): Map<SpaceKey, { key: SpaceKey; barrier: Barrier }[]> {
  const out = new Map<SpaceKey, { key: SpaceKey; barrier: Barrier }[]>();
  const push = (from: SpaceKey, key: SpaceKey, barrier: Barrier) => {
    const list = out.get(from) ?? [];
    list.push({ key, barrier });
    out.set(from, list);
  };
  for (const e of graph.edges) {
    push(e.a, e.b, e.barrier);
    push(e.b, e.a, e.barrier);
  }
  for (const list of out.values()) list.sort((x, y) => compareStrings(x.key, y.key));
  return out;
}

/**
 * El grafo con el campo abierto de cada hex que se pide, unido sin barrera a los espacios al
 * aire libre de ese hex. Es lo que usa la percepción cuando alguien está en un hex sin espacio.
 */
export function withOpenSpaces(
  graph: SpaceGraph,
  hexes: readonly { readonly hex: number; readonly forest: boolean }[],
): SpaceGraph {
  const have = new Set(graph.spaces.map((s) => s.key));
  const spaces = [...graph.spaces];
  const edges = [...graph.edges];
  for (const { hex, forest } of [...hexes].sort((a, b) => a.hex - b.hex)) {
    const open = openSpace(hex, forest);
    if (have.has(open.key)) continue;
    have.add(open.key);
    spaces.push(open);
    for (const s of graph.spaces) {
      if (s.hex === hex && !s.indoor) edges.push({ a: open.key, b: s.key, barrier: "open" });
    }
  }
  return { spaces, edges };
}

/** Cómo se arma la aldea mínima: dónde está y qué hogares tiene. */
export interface VillageSpacesInput {
  /** El hex de la aldea en el parche local. */
  readonly hex: number;
  readonly households: readonly HouseholdId[];
}

/** La clave de la plaza de la aldea y la de la casa de un hogar. */
export const VILLAGE_SQUARE: SpaceKey = "square";
export function houseKey(household: HouseholdId): SpaceKey {
  return `house:${household}`;
}

/**
 * La aldea mínima de la Fase 1 (perception §Implementación): una plaza con el pozo y una casa de
 * un cuarto por hogar, de madera, con la puerta a la plaza. De día la puerta queda abierta (un
 * vano con cortina); el fuego del hogar da algo de luz adentro. Settlements (§5, §8) la
 * reemplaza por edificios con componentes, calles y patios.
 */
export function villageSpaces(input: VillageSpacesInput): SpaceGraph {
  const square: SpaceNode = {
    key: VILLAGE_SQUARE,
    kind: "square",
    hex: input.hex,
    area: 40 * 40,
    indoor: false,
    daylight: 1,
    lamp: 0,
    noise: 0.05,
    clearSight: 1,
  };
  const houses = [...input.households].sort(compareStrings).map(
    (h): SpaceNode => ({
      key: houseKey(h),
      kind: "room",
      hex: input.hex,
      area: 5 * 6,
      indoor: true,
      daylight: 0.25,
      lamp: 0.1,
      noise: 0.02,
      clearSight: 1,
      household: h,
    }),
  );
  return {
    spaces: [square, ...houses],
    edges: houses.map((h) => ({ a: VILLAGE_SQUARE, b: h.key, barrier: "doorway" as const })),
  };
}

/** La luz en un espacio (0-1) con la luz del día de afuera. */
export function spaceLight(space: SpaceNode, daylightNow: number): number {
  return Math.min(1, daylightNow * space.daylight + space.lamp);
}
