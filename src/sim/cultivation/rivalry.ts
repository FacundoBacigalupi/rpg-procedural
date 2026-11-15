// La rivalidad entre las dos sectas de la región (novel4-rival-sect-relation, organizations §10):
// dos sectas al alcance compiten por el mismo qi, los mismos discípulos y la misma aldea. Cuando la
// más nueva se funda, la rivalidad nace con ella (`org.rivalry`, causada por las dos fundaciones) y
// cada una guarda su `OrgTie` hacia la otra: la fuerza que le cree, contada de lo que se ve de sus
// ancianos y discípulos con un error propio (`seededBelief`: se puede pasar o quedar corta), y un
// sentimiento de rival (respeto y desconfianza, el miedo según cuánto más fuerte la cree).
//
// Puro: sin IO. El rng sale del seed con su propia rama, así que no corre los de la siembra.

import {
  type EntityRef,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  ORG_RELATION,
  type OrgRelations,
  type OrgSentiment,
  type OrgStrength,
  type OrgTie,
} from "../org/index.ts";
import type { WorldTruth } from "../world/index.ts";
import { SECT, type Sect } from "./sect.ts";

export const ORG_RIVALRY_EVENT = "org.rivalry";

/** Cuánto puede errar una secta al contar a la otra (fracción, sin calibrar). */
export const BELIEF_ERROR = 0.4;

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => round3(Math.min(1, Math.max(0, x)));

/** La fuerza de verdad de una secta, de sus ranuras. */
export function sectStrength(s: Sect): OrgStrength {
  return {
    elders: s.slots.filter((x) => x.rank === "elder" || x.rank === "master").length,
    disciples: s.slots.filter((x) => x.rank === "disciple").length,
    topStage: s.slots.reduce((m, x) => Math.max(m, x.stage), 0),
  };
}

/** Un número de fuerza para comparar (ancianos pesan más; el umbral más alto, más todavía). */
export function strengthScore(s: OrgStrength): number {
  return s.disciples + 3 * s.elders + 4 * s.topStage;
}

/** Lo que una secta cree de la fuerza de otra: la verdad con un error que sale del rng. */
export function seededBelief(truth: OrgStrength, rng: Rng): OrgStrength {
  const off = (n: number) =>
    Math.max(0, Math.round(n * (1 + BELIEF_ERROR * (2 * rng.float() - 1))));
  return {
    elders: Math.max(1, off(truth.elders)),
    disciples: off(truth.disciples),
    topStage: Math.max(0, truth.topStage + rng.int(-1, 1)),
  };
}

/** El sentimiento de rival de quien cree `mine` contra quien cree `theirs`. */
export function rivalSentiment(mine: OrgStrength, theirs: OrgStrength, rng: Rng): OrgSentiment {
  const ratio = strengthScore(theirs) / Math.max(1, strengthScore(mine) + strengthScore(theirs));
  return {
    trust: clamp01(0.05 + 0.15 * rng.float()),
    respect: clamp01(0.3 + 0.3 * rng.float()),
    fear: clamp01(ratio - 0.3 + 0.1 * rng.float()),
    resentment: clamp01(0.1 + 0.3 * rng.float()),
  };
}

export interface SeedRivalryOptions {
  readonly seed: Seed;
  readonly a: EntityRef;
  readonly b: EntityRef;
  readonly place: PlaceRef;
}

/**
 * Siembra la rivalidad entre las sectas `a` y `b`: el evento que la abre (cuando se funda la más
 * nueva, causado por las dos fundaciones) y la relación de cada una hacia la otra.
 */
export function seedRivalry(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedRivalryOptions,
): EventId | undefined {
  const sa = truth.get(SECT, o.a);
  const sb = truth.get(SECT, o.b);
  if (!sa || !sb) return undefined;
  const rng = Rng.root(o.seed).fork("cultivation", "sect", "rivalry");
  const event = ids.next("event") as EventId;
  const tick: Tick = Math.max(sa.founded, sb.founded);
  log.append({
    id: event,
    tick,
    kind: ORG_RIVALRY_EVENT,
    actors: [],
    place: o.place,
    data: { a: o.a, b: o.b, stance: "rival" },
    emissions: {},
    causes: [
      { kind: "event", event: sa.originEventId },
      { kind: "event", event: sb.originEventId },
    ],
    resolution: "world",
  });
  const tie = (from: Sect, to: Sect, key: string): OrgTie => {
    const r = rng.fork(key);
    const believed = seededBelief(sectStrength(to), r.fork("believed"));
    return {
      formal: ["rival"],
      sentiment: rivalSentiment(sectStrength(from), believed, r.fork("sentiment")),
      believedStrength: believed,
      grievances: [],
      originEventId: event,
      history: [event],
    };
  };
  const add = (from: EntityRef, to: EntityRef, t: OrgTie): void => {
    const had: OrgRelations = truth.get(ORG_RELATION, from) ?? { toward: {} };
    truth.set(ORG_RELATION, from, { toward: { ...had.toward, [to]: t } });
  };
  add(o.a, o.b, tie(sa, sb, "a"));
  add(o.b, o.a, tie(sb, sa, "b"));
  return event;
}
