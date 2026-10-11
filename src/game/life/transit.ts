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
      let walk = rec.walk;
      if (loc.hex !== rec.seen) {
        // `life.act` lo movió: de donde estaba a donde dice que llegó, caminando desde la última vez.
        const path = hexPath(o.map, rec.seen, loc.hex);
        walk =
          path.length === 0
            ? undefined
            : { from: rec.seen, to: loc.hex, path, t0: rec.at, seconds: walkSeconds(o.map, path) };
      }
      if (!walk) return { changes: [setComponent(TRANSIT, me, { seen: loc.hex, at: ctx.now })] };
      const elapsed = ctx.now - walk.t0;
      const arrived = elapsed >= walk.seconds;
      const pos = arrived ? walk.to : positionAlong(o.map, walk.from, walk.path, elapsed);
      return {
        changes: [
          ...(pos === loc.hex ? [] : [setComponent(LOCATION, me, { hex: pos })]),
          setComponent(TRANSIT, me, {
            seen: pos,
            at: ctx.now,
            ...(arrived ? {} : { walk }),
          }),
        ],
      };
    },
  };
}
