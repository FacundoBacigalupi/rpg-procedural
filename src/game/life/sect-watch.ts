// Vigilar el límite (novel4-watch, organizations §10): el puesto de guardia de una secta es el hex
// del camino hacia la sede de la otra, a `MISSION_WATCH_RADIUS` pasos de la propia (o, si quedan más
// cerca, el anterior a la otra). El mapa de la región y las sedes no cambian: el puesto se calcula una
// vez por par y se guarda (`watchPosts`). La otra secta es amenaza cuando el rencor o el miedo que le
// tiene llega a `WATCH_THREAT` (`threatens`); entonces el anciano da la guardia en ese puesto.

import type { EntityRef } from "../../core/index.ts";
import {
  type LocalMap,
  MISSION_WATCH_RADIUS,
  ORG_RELATION,
  orgTie,
  PLACE,
  type ReadonlyWorldTruth,
  type RivalThreat,
  SECT,
  threatens,
} from "../../sim/index.ts";

/**
 * El puesto en el camino de `from` a `to` (puro): el camino más corto por el mapa (BFS, vecinos en
 * orden), y en él el hex a `radius` pasos de `from`, sin llegar a `to` (si el camino es corto, el
 * anterior a `to`). Undefined si no hay camino o `from` es `to`.
 */
export function watchPost(
  map: LocalMap,
  from: number,
  to: number,
  radius: number,
): { readonly hex: number; readonly distance: number } | undefined {
  if (from === to) return undefined;
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
  if (!prev.has(to)) return undefined;
  const path: number[] = [];
  for (let h = to; h !== from; h = prev.get(h) as number) path.push(h);
  path.push(from);
  path.reverse();
  const distance = Math.max(1, Math.min(radius, path.length - 2));
  const hex = path[distance];
  return hex === undefined ? undefined : { hex, distance };
}

/** El primer hex de la sede de `org`, si tiene lugar en el mapa. */
function seatHexOf(truth: ReadonlyWorldTruth, org: EntityRef): number | undefined {
  const seat = truth.get(SECT, org)?.seatPlace;
  return seat ? truth.get(PLACE, seat)?.hexes[0] : undefined;
}

/** El puesto de guardia de `org` hacia `other`, si hay camino. */
export type WatchPostOf = (
  truth: ReadonlyWorldTruth,
  org: EntityRef,
  other: EntityRef,
) => { readonly hex: number; readonly distance: number } | undefined;

/**
 * Los puestos de guardia, por par de sectas (`${org}|${other}`), guardados: el mapa y las sedes no
 * cambian en la vida. Devuelve la función que los da.
 */
export function watchPosts(map: LocalMap): WatchPostOf {
  const kept = new Map<string, { hex: number; distance: number } | undefined>();
  return (truth, org, other) => {
    const key = `${org}|${other}`;
    if (!kept.has(key)) {
      const from = seatHexOf(truth, org);
      const to = seatHexOf(truth, other);
      kept.set(
        key,
        from === undefined || to === undefined
          ? undefined
          : watchPost(map, from, to, MISSION_WATCH_RADIUS),
      );
    }
    return kept.get(key);
  };
}

/** Las sectas que `org` tiene en guardia, con su puesto (las que no tienen camino, no). */
export function rivalThreats(
  truth: ReadonlyWorldTruth,
  org: EntityRef,
  postOf: WatchPostOf,
): RivalThreat[] {
  const relations = truth.get(ORG_RELATION, org);
  const out: RivalThreat[] = [];
  for (const other of Object.keys(relations?.toward ?? {}).sort() as EntityRef[]) {
    if (!threatens(orgTie(relations, other))) continue;
    const post = postOf(truth, org, other);
    if (post) out.push({ against: other, hex: post.hex, distance: post.distance });
  }
  return out;
}
