// La cultura de cada persona al empezar (culture §4, Fase 2): cada vivo (y cada muerto de la
// pre-corrida, para que sus hijos lo hayan copiado) sigue una variante por rasgo. Se siembra en
// orden de nacimiento: los que no tienen padres registrados salen de la prevalencia de la
// comunidad; los demás copian a sus padres en vertical (`learnedFrom` los nombra).

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
import { PERSON_CULTURE, type PersonCulture, seedPersonCulture } from "./person.ts";
import type { CommunityCulture } from "./seed.ts";
import type { TraitDef } from "./trait.ts";

export interface SeedPeopleCultureInput {
  readonly seed: Seed;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly community: CommunityCulture;
  readonly traits: readonly TraitDef[];
}

/** Escribe `PERSON_CULTURE` de toda la gente de la aldea. Devuelve el evento de la siembra. */
export function seedPeopleCulture(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedPeopleCultureInput,
): EventId {
  const event = ids.next("event");
  const people = (truth.ids(PERSON) as AgentId[])
    .map((id) => ({ id, rec: truth.get(PERSON, id) }))
    .filter((p): p is { id: AgentId; rec: NonNullable<typeof p.rec> } => p.rec !== undefined)
    .sort((a, b) => a.rec.born - b.rec.born || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  log.append({
    id: event,
    tick: input.now,
    kind: "culture.people_seeded",
    actors: people.map((p) => p.id),
    place: input.place,
    data: { culture: input.community.culture },
    emissions: {},
    causes: [{ kind: "event", event: input.community.originEventId }],
    resolution: "local",
  });
  const root = Rng.root(input.seed);
  const done = new Map<AgentId, PersonCulture>();
  for (const { id, rec } of people) {
    const parents = [rec.mother, rec.father].flatMap((p) => {
      const culture = p === null ? undefined : done.get(p);
      return p !== null && culture ? [{ id: p, culture }] : [];
    });
    const culture = seedPersonCulture(
      {
        community: input.community,
        traits: input.traits,
        parents,
        since: rec.born,
        originEventId: event,
      },
      root.fork("person-culture", id),
    );
    done.set(id, culture);
    truth.set(PERSON_CULTURE, id, culture);
  }
  return event;
}
