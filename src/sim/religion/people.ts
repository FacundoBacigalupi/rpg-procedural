// La fe de cada persona al empezar (religion §1, Fase 2): cada vivo (y cada muerto de la
// pre-corrida, para que sus hijos lo hayan heredado) tiene una afiliación a la religión de la
// aldea. Se siembra en orden de nacimiento: quien no tiene padres registrados parte de la media
// de la comunidad; los demás siguen a sus padres (`learnedFrom` los nombra).

import {
  type AgentId,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import { PERSON } from "../family/index.ts";
import type { WorldTruth } from "../world/index.ts";
import { type Affiliation, RELIGIOUS_IDENTITY, seedAffiliation } from "./identity.ts";
import type { CommunityReligion } from "./seed.ts";

export interface SeedPeopleReligionInput {
  readonly seed: Seed;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly religion: CommunityReligion;
}

/** Escribe `RELIGIOUS_IDENTITY` de toda la gente de la aldea. Devuelve el evento de la siembra. */
export function seedPeopleReligion(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedPeopleReligionInput,
): EventId {
  const event = ids.next("event");
  const people = (truth.ids(PERSON) as AgentId[])
    .map((id) => ({ id, rec: truth.get(PERSON, id) }))
    .filter((p): p is { id: AgentId; rec: NonNullable<typeof p.rec> } => p.rec !== undefined)
    .sort((a, b) => a.rec.born - b.rec.born || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  log.append({
    id: event,
    tick: input.now,
    kind: "religion.people_seeded",
    actors: people.map((p) => p.id),
    place: input.place,
    data: { religion: input.religion.religion },
    emissions: {},
    causes: [{ kind: "event", event: input.religion.originEventId }],
    resolution: "local",
  });
  const root = Rng.root(input.seed);
  const done = new Map<AgentId, Affiliation>();
  for (const { id, rec } of people) {
    const raised = [rec.mother, rec.father].flatMap((p) => {
      const aff = p === null ? undefined : done.get(p);
      return p !== null && aff ? [{ id: p, aff }] : [];
    });
    const aff = seedAffiliation(
      {
        religion: input.religion,
        parents: raised.map((r) => r.aff),
        learnedFrom: raised.map((r) => r.id),
        since: rec.born,
        originEventId: event,
      },
      root.fork("person-religion", id),
    );
    done.set(id, aff);
    truth.set(RELIGIOUS_IDENTITY, id, { affiliations: [aff], doubts: [] });
  }
  return event;
}
