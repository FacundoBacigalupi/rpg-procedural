// La mente de cada vivo al empezar (npc-psychology §1-§2, Fase 2): los esquemas de base salen de su
// temperamento (`baselineSchemas`) con una variación propia por `rng.fork("psyche", id)`. La
// historia de cada uno antes del juego no se simula: la causa de todo lo de base es el evento de
// la siembra, que cuelga de la fundación.

import {
  type AgentId,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Tick,
} from "../../core/index.ts";
import { INNATE, PERSON } from "../family/index.ts";
import { ENTITY, type WorldTruth } from "../world/index.ts";
import { baselineSchemas, MIND, type Mind, type SchemaDef } from "./mind.ts";

export interface SeedMindsInput {
  readonly seed: number;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
  readonly schemas: readonly SchemaDef[];
}

/** Variación personal de la fuerza de base de un esquema (desvío). */
export const BASELINE_JITTER = 0.05;

/** Escribe `MIND` de cada vivo. Devuelve el evento de la siembra. */
export function seedMinds(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedMindsInput,
): EventId {
  const event = ids.next("event");
  const alive = (truth.ids(PERSON) as AgentId[]).filter(
    (id) => truth.get(ENTITY, id)?.endedAt === undefined,
  );
  log.append({
    id: event,
    tick: input.now,
    kind: "mind.seeded",
    actors: alive,
    place: input.place,
    data: null,
    emissions: {},
    causes: [{ kind: "event", event: input.foundersEvent }],
    resolution: "local",
  });
  const root = Rng.root(input.seed);
  for (const id of alive) {
    const innate = truth.get(INNATE, id);
    if (!innate) continue;
    const rng = root.fork("psyche", id);
    const base = baselineSchemas(input.schemas, innate, () => rng.normal(0, BASELINE_JITTER));
    const schemas: Mind["schemas"] = Object.fromEntries(
      Object.entries(base).map(([k, strength]) => [k, { strength, causes: [event] }]),
    );
    truth.set(MIND, id, { schemas, formative: [], originEventId: event });
  }
  return event;
}
