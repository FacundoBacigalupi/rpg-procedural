// Las relaciones al empezar (npc-psychology §6, Fase 2): de la pre-corrida salen el parentesco y
// el hogar, no la historia entre las personas. Cada par con algún vínculo (padres, hijos,
// hermanos, cónyuge, abuelos, nietos, la misma casa) arranca desde la línea base más lo que pone
// el vínculo, con una variación propia por `rng.fork("relation", from, to)` y la calidez de quien
// siente. Los extraños no figuran: son la línea base. La causa de todo es el evento de la siembra.

import {
  type AgentId,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Tick,
} from "../../core/index.ts";
import { INNATE, PERSON, type PersonRecord } from "../family/index.ts";
import { ENTITY, type WorldTruth } from "../world/index.ts";
import {
  type BondDef,
  clampDim,
  DIMENSIONS,
  type DimensionDef,
  RELATIONS,
  type Relations,
  type Relationship,
  strangerDims,
} from "./relations.ts";

export interface SeedRelationsInput {
  readonly seed: number;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
}

/** Desvío de la variación personal de cada relación. */
export const RELATION_JITTER = 0.05;
/** Cuánto suma la calidez de quien siente al afecto de un vínculo. */
export const WARMTH_TO_AFFECTION = 0.1;
/** Las dimensiones que varían de un par a otro al sembrar. */
const JITTERED = ["trust", "respect", "affection", "fear", "resentment"] as const;

/** Qué es `b` para `a` según el registro civil: los ids de vínculo, ordenados. */
export function kinBonds(
  a: AgentId,
  b: AgentId,
  person: (id: AgentId) => PersonRecord | undefined,
): string[] {
  const pa = person(a);
  const pb = person(b);
  if (!pa || !pb || a === b) return [];
  const parentsOf = (p: PersonRecord) => [p.mother, p.father].filter((x): x is AgentId => !!x);
  const out = new Set<string>();
  const mine = parentsOf(pa);
  const theirs = parentsOf(pb);
  if (mine.includes(b)) out.add("parent");
  if (theirs.includes(a)) out.add("child");
  if (pa.spouse === b || pb.spouse === a) out.add("spouse");
  if (mine.some((p) => theirs.includes(p))) out.add("sibling");
  const grand = (p: PersonRecord) =>
    parentsOf(p).flatMap((x) => {
      const px = person(x);
      return px ? parentsOf(px) : [];
    });
  if (grand(pa).includes(b)) out.add("grandparent");
  if (grand(pb).includes(a)) out.add("grandchild");
  if (pa.household === pb.household) out.add("housemate");
  return [...out].sort();
}

export interface KinRelationInput {
  /** `rng.fork("relation", from, to)`: la variación personal de este par. */
  readonly rng: { normal(mean: number, sd: number): number };
  /** Las dimensiones de un extraño (`strangerDims`). */
  readonly dims: Readonly<Record<string, number>>;
  readonly bonds: readonly BondDef[];
  readonly event: EventId;
  readonly now: Tick;
}

/**
 * Lo que `from` siente por `to` según el registro civil: la línea base más lo que pone cada vínculo,
 * una variación propia y la calidez de quien siente. Sin vínculo, `undefined` (es un extraño).
 */
export function kinRelationship(
  from: AgentId,
  to: AgentId,
  person: (id: AgentId) => PersonRecord | undefined,
  warmth: number,
  i: KinRelationInput,
): Relationship | undefined {
  const bonds = kinBonds(from, to, person);
  if (bonds.length === 0) return undefined;
  const dims = { ...i.dims } as Record<(typeof DIMENSIONS)[number], number>;
  for (const id of bonds) {
    const def = i.bonds.find((b) => b.id === id);
    if (!def) continue;
    for (const d of DIMENSIONS) dims[d] += def.initial[d] ?? 0;
  }
  for (const d of JITTERED) dims[d] += i.rng.normal(0, RELATION_JITTER);
  dims.affection += warmth * WARMTH_TO_AFFECTION;
  for (const d of DIMENSIONS) dims[d] = clampDim(d, dims[d]);
  return { dims, bonds, history: [i.event], updated: i.now };
}

/** Escribe `RELATIONS` de cada vivo con algún vínculo. Devuelve el evento de la siembra. */
export function seedRelations(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedRelationsInput,
): EventId {
  const event = ids.next("event");
  const alive = (truth.ids(PERSON) as AgentId[]).filter(
    (id) => truth.get(ENTITY, id)?.endedAt === undefined,
  );
  log.append({
    id: event,
    tick: input.now,
    kind: "relations.seeded",
    actors: alive,
    place: input.place,
    data: null,
    emissions: {},
    causes: [{ kind: "event", event: input.foundersEvent }],
    resolution: "local",
  });
  const person = (id: AgentId) => truth.get(PERSON, id);
  const root = Rng.root(input.seed);
  const stranger = strangerDims(input.dims);
  for (const from of alive) {
    const warmth = truth.get(INNATE, from)?.["warmth"] ?? 0;
    const toward: Record<string, Relationship> = {};
    for (const to of alive) {
      const r = kinRelationship(from, to, person, warmth, {
        rng: root.fork("relation", from, to),
        dims: stranger,
        bonds: input.bonds,
        event,
        now: input.now,
      });
      if (r) toward[to] = r;
    }
    if (Object.keys(toward).length === 0) continue;
    const relations: Relations = { toward, originEventId: event };
    truth.set(RELATIONS, from, relations);
  }
  return event;
}
