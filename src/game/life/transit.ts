// El cuerpo en el camino (travel §2, npc-b2b1): `life.act` fija la posición del tramo de `move` al
// empezar y después cobra las horas; con esto el NPC que viaja pasa por los hexes del camino
// mientras dura la marcha, en vez de estar ya en el destino. Cada hora, si la posición saltó
// respecto de la que este proceso dejó, el salto se vuelve una caminata: se calcula el camino
// (`hexPath`), el tiempo que cuesta (`crossSeconds`) y se lo ubica donde le toca. Opt-in
// (`LifeParts.npcTransit`) y solo para quien tiene un viaje abierto (`NPC_JOURNEY`).

import type { AgentId, Tick } from "../../core/index.ts";
import {
  ENTITY,
  hexPath,
  LOCATION,
  type LocalMap,
  type ProcessDef,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const TRANSIT_PROCESS = "life.transit";

export interface Walk {
  readonly from: number;
  readonly to: number;
  /** Hexes del camino, sin el de salida, con el de llegada. */
  readonly path: readonly number[];
  readonly t0: Tick;
  readonly seconds: number;
}

/** Lo último que este proceso vio o dejó de la posición, y la caminata en curso si hay una. */
export interface Transit {
  readonly seen: number;
  readonly at: Tick;
  readonly walk?: Walk;
}

export const TRANSIT = table<Transit>("life.transit");

/** Cuánto cuesta caminar un camino (puro): suma de lo que cuesta cruzar cada hex. */
export function walkSeconds(map: Pick<LocalMap, "crossSeconds">, path: readonly number[]): number {
  return path.reduce((t, h) => t + (map.crossSeconds[h] ?? 0), 0);
}

/**
 * Dónde está quien camina `path` desde `from` tras `elapsed` segundos (puro): el último hex cuyo
 * cruce completó; sin completar el primero, sigue en `from`.
 */
export function positionAlong(
  map: Pick<LocalMap, "crossSeconds">,
  from: number,
  path: readonly number[],
  elapsed: number,
): number {
  let pos = from;
  let spent = 0;
  for (const h of path) {
    spent += map.crossSeconds[h] ?? 0;
    if (spent > elapsed) break;
    pos = h;
  }
  return pos;
}

export function transitProcess(o: {
  readonly map: LocalMap;
  readonly player: AgentId;
}): ProcessDef {
  return {
    id: TRANSIT_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [ENTITY.name, LOCATION.name, NPC_JOURNEY.name, TRANSIT.name],
    writes: [LOCATION.name, TRANSIT.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const loc = truth.get(LOCATION, me);
      const journey = truth.get(NPC_JOURNEY, me);
      // Al abrir el viaje todavía no hay registro: se parte de donde salió, cuando salió.
      const rec: Transit | undefined =
        truth.get(TRANSIT, me) ??
        (journey?.from !== undefined ? { seen: journey.from, at: journey.since } : undefined);
      if (!loc || !journey) {
        // Sin viaje no hay caminata: se suelta lo que quedara.
        return rec
          ? { changes: [setComponent(TRANSIT, me, { seen: loc?.hex ?? rec.seen, at: ctx.now })] }
          : {};
      }
      if (!rec) return { changes: [setComponent(TRANSIT, me, { seen: loc.hex, at: ctx.now })] };
      const step = advanceTransit(o.map, rec, loc.hex, ctx.now);
      return {
        changes: [
          ...(step.pos === loc.hex ? [] : [setComponent(LOCATION, me, { hex: step.pos })]),
          setComponent(TRANSIT, me, step.next),
        ],
      };
    },
  };
}

/**
 * Un paso de la caminata (puro): dado lo último que se vio (`rec`), dónde está ahora el cuerpo
 * (`locHex`, donde `life.act` lo dejó) y la hora, dónde le toca estar y el registro nuevo. Si el
 * cuerpo saltó respecto de lo visto, el salto es una caminata desde la última vez.
 */
export function advanceTransit(
  map: LocalMap,
  rec: Transit,
  locHex: number,
  now: Tick,
): { readonly pos: number; readonly next: Transit } {
  let walk = rec.walk;
  if (locHex !== rec.seen) {
    const path = hexPath(map, rec.seen, locHex);
    walk =
      path.length === 0
        ? undefined
        : { from: rec.seen, to: locHex, path, t0: rec.at, seconds: walkSeconds(map, path) };
  }
  if (!walk) return { pos: locHex, next: { seen: locHex, at: now } };
  const elapsed = now - walk.t0;
  const arrived = elapsed >= walk.seconds;
  const pos = arrived ? walk.to : positionAlong(map, walk.from, walk.path, elapsed);
  return { pos, next: { seen: pos, at: now, ...(arrived ? {} : { walk }) } };
}
