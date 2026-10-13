// Encuentros en el camino (travel §3, npc-b2b4a): no se tiran de una tabla, se busca quién está en
// el mismo hex al mismo tiempo. El viajero con un viaje abierto (`NPC_JOURNEY`) que comparte hex con
// otra persona viva se la cruza, y eso queda como evento `npc.crossed` con causa en la posición de
// ambos. Una sola vez por persona y viaje (`NPC_MET`). Opt-in (`LifeParts.npcEncounters`).

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  deleteComponent,
  ENTITY,
  type EventDraft,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const NPC_ENCOUNTERS_PROCESS = "life.npc_encounters";
export const CROSSED_EVENT = "npc.crossed";

/** A quién ya se cruzó en este viaje (el viaje se identifica por cuándo empezó). */
export const NPC_MET = table<{ readonly since: number; readonly met: readonly string[] }>(
  "life.npc_met",
);

/** Tope de cruces que se registran en una misma pasada, para que una plaza llena no inunde el registro. */
export const MAX_CROSSINGS_PER_PASS = 3;

export interface NpcEncountersOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function npcEncountersProcess(o: NpcEncountersOptions): ProcessDef {
  return {
    id: NPC_ENCOUNTERS_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [ENTITY.name, LOCATION.name, NPC_JOURNEY.name, NPC_MET.name],
    writes: [NPC_MET.name],
    // Sin viaje ni libreta de cruces, `run` devuelve `{}`.
    scopeGuard: (truth, scope) =>
      truth.get(NPC_JOURNEY, scope as AgentId) !== undefined ||
      truth.get(NPC_MET, scope as AgentId) !== undefined,
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const trip = truth.get(NPC_JOURNEY, me);
      const book = truth.get(NPC_MET, me);
      if (!trip) return book ? { changes: [deleteComponent(NPC_MET, me)] } : {};
      const here = truth.get(LOCATION, me)?.hex;
      if (here === undefined) return {};
      const met = new Set(book && book.since === trip.since ? book.met : []);
      const crossed = truth
        .ids(LOCATION)
        .filter(
          (id) =>
            id !== me &&
            id.startsWith("agent:") &&
            truth.get(LOCATION, id)?.hex === here &&
            truth.get(ENTITY, id)?.endedAt === undefined &&
            !met.has(id),
        )
        .sort()
        .slice(0, MAX_CROSSINGS_PER_PASS) as AgentId[];
      if (crossed.length === 0) return {};
      const events: EventDraft[] = crossed.map((other) => ({
        kind: CROSSED_EVENT,
        actors: [me, other],
        place: o.placeOf(truth, me),
        data: { hex: here, journey: trip.place },
        emissions: {},
        causes: [
          { kind: "state", entity: me, key: "location" },
          { kind: "state", entity: other, key: "location" },
        ],
      }));
      for (const other of crossed) met.add(other);
      return {
        changes: [setComponent(NPC_MET, me, { since: trip.since, met: [...met].sort() })],
        events,
      };
    },
  };
}
