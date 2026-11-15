// Vigilar el límite (novel4-watch, organizations §10): el puesto de guardia de una secta es el hex
// del camino hacia la sede de la otra, a `MISSION_WATCH_RADIUS` pasos de la propia (o, si quedan más
// cerca, el anterior a la otra). El mapa de la región y las sedes no cambian: el puesto se calcula una
// vez por par y se guarda (`watchPosts`). La otra secta es amenaza cuando el rencor o el miedo que le
// tiene llega a `WATCH_THREAT` (`threatens`); entonces el anciano da la guardia en ese puesto.
//
// La guardia de cuerpo (novel4-watch-npc, `sectWatchProcess`): cada `WATCH_SEND_EVERY_DAYS` días la
// secta revisa sus puestos; si nadie tiene la guardia hacia una secta que la amenaza, se la da a uno
// de los suyos libre de rango (`pickEnvoy`: interno o anciano, primero el que esté en la sede). La da
// con el mismo evento que el anciano (`MISSION_ASSIGNED_EVENT`) y la anota `sect-duty`. El guardia va
// al lugar del puesto (`post`, creado con la rivalidad), espera ahí las horas que faltan y vuelve a la
// sede a contar (`watchDestination`, que lee `decide`); las horas y el cobro son los de siempre.

import { type AgentId, compareStrings, type EntityRef, type PlaceId } from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  type EventDraft,
  LOCATION,
  type LocalMap,
  MISSION_ASSIGNED_EVENT,
  MISSION_WATCH_RADIUS,
  missionDue,
  missionLapsed,
  ORG_RELATION,
  orgTie,
  PLACE,
  type ProcessDef,
  pickMission,
  type ReadonlyWorldTruth,
  type RivalThreat,
  rivalWatchNeeds,
  SECT,
  SECT_MEMBER,
  SECT_MISSION,
  type SectMission,
  threatens,
} from "../../sim/index.ts";
import { atSeat, pickEnvoy } from "./sect-grievance.ts";

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

/** Cada cuántos días la secta revisa si alguien tiene la guardia (novel4-watch-npc). */
export const WATCH_SEND_EVERY_DAYS = 3;
export const SECT_WATCH_PROCESS = "life.sect_watch";

/** El lugar del puesto en `hex` (`post`), si lo hay. */
export function postPlaceAt(truth: ReadonlyWorldTruth, hex: number): string | undefined {
  for (const id of [...truth.ids(PLACE)].sort(compareStrings)) {
    const p = truth.get(PLACE, id);
    if (p?.kind === "post" && p.hexes[0] === hex) return id;
  }
  return undefined;
}

/**
 * Qué hace el guardia (puro, novel4-watch-npc): con horas por cumplir, ir al puesto o, ya ahí,
 * esperar las que faltan; cumplidas, volver a la sede. Undefined si no tiene una guardia hacia otra
 * secta, si el puesto no tiene lugar o si ya está en la sede con la guardia cumplida.
 */
export function watchDestination(
  truth: ReadonlyWorldTruth,
  who: AgentId,
):
  | { readonly kind: "go"; readonly place: string }
  | { readonly kind: "wait"; readonly seconds: number }
  | undefined {
  const m = truth.get(SECT_MISSION, who);
  if (m?.kind !== "watch" || m.against === undefined || m.hex === undefined) return undefined;
  const hours = m.hours ?? 0;
  if (m.done >= hours) {
    if (atSeat(truth, who, m.org)) return undefined;
    const seat = truth.get(SECT, m.org)?.seatPlace;
    return seat === undefined ? undefined : { kind: "go", place: seat };
  }
  if (truth.get(LOCATION, who)?.hex === m.hex)
    return { kind: "wait", seconds: Math.ceil((hours - m.done) * 3600) };
  const post = postPlaceAt(truth, m.hex);
  return post === undefined ? undefined : { kind: "go", place: post };
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return (
    truth.get(ENTITY, id)?.endedAt === undefined &&
    (truth.get(BODY_STATE, id)?.death ?? null) === null
  );
}

/**
 * Quién da la guardia: el anciano vivo de la secta (el primero por id), no el guardia ni el
 * personaje; si no hay, el maestro; si tampoco, el mismo guardia.
 */
function giverOf(
  truth: ReadonlyWorldTruth,
  org: EntityRef,
  guard: AgentId,
  player: AgentId,
): AgentId {
  const ids = [...truth.ids(SECT_MEMBER)].sort(compareStrings) as AgentId[];
  const of = (rank: string) =>
    ids.find((id) => {
      const m = truth.get(SECT_MEMBER, id);
      return m?.org === org && m.rank === rank && id !== guard && id !== player && alive(truth, id);
    });
  return of("elder") ?? of("master") ?? guard;
}

/**
 * La secta manda a uno de los suyos de guardia (cableado opt-in, novel4-watch-npc): cada
 * `WATCH_SEND_EVERY_DAYS` días, por secta con amenaza y sin guardia vigente hacia ella, a un libre de
 * rango. Solo emite `MISSION_ASSIGNED_EVENT`; la misión la anota `sect-duty`.
 */
export function sectWatchProcess(o: {
  readonly dayTicks: number;
  /** El personaje: no se lo elige (él la pide si quiere). */
  readonly player: AgentId;
  readonly postOf: WatchPostOf;
}): ProcessDef {
  return {
    id: SECT_WATCH_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      SECT.name,
      SECT_MEMBER.name,
      SECT_MISSION.name,
      ORG_RELATION.name,
      PLACE.name,
      LOCATION.name,
      ENTITY.name,
      BODY_STATE.name,
    ],
    writes: [],
    run(ctx) {
      const truth = ctx.truth;
      if (Math.floor(ctx.now / o.dayTicks) % WATCH_SEND_EVERY_DAYS !== 0) return {};
      const assigned: SectMission[] = [];
      for (const id of [...truth.ids(SECT_MISSION)].sort(compareStrings)) {
        const m = truth.get(SECT_MISSION, id);
        if (m && !missionLapsed(m, ctx.now)) assigned.push(m);
      }
      const busy = new Set<AgentId>();
      const events: EventDraft[] = [];
      for (const org of [...truth.ids(SECT)].sort(compareStrings) as EntityRef[]) {
        const threats = rivalThreats(truth, org, o.postOf);
        if (threats.length === 0) continue;
        const relations = truth.get(ORG_RELATION, org);
        for (const need of rivalWatchNeeds(threats)) {
          // Como a un interno: el anciano también va, pero la misión es de ese rango.
          const offer = pickMission(org, "inner", [need], assigned);
          if (!offer) continue;
          const guard = pickEnvoy(truth, org, o.player, busy);
          if (guard === undefined) break;
          const by = giverOf(truth, org, guard, o.player);
          const due = missionDue("watch", ctx.now, o.dayTicks);
          busy.add(guard);
          assigned.push({ ...offer, by, at: ctx.now, due, done: 0 });
          const tie = offer.against !== undefined ? orgTie(relations, offer.against) : undefined;
          const seat = truth.get(SECT, org)?.seatPlace;
          events.push({
            kind: MISSION_ASSIGNED_EVENT,
            actors: [guard, by],
            place: { kind: "place", place: (seat ?? org) as unknown as PlaceId },
            data: { ...offer, by, due },
            emissions: {},
            causes: [
              ...(tie
                ? [{ kind: "event" as const, event: tie.history.at(-1) ?? tie.originEventId }]
                : []),
              { kind: "state", entity: org, key: ORG_RELATION.name },
              { kind: "state", entity: guard as unknown as EntityRef, key: SECT_MEMBER.name },
            ],
          });
        }
      }
      return events.length > 0 ? { events } : {};
    },
  };
}
