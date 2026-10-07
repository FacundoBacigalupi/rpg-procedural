// Quién es quién al empezar (social-structure §12, §14): el estatus de cada hogar de la aldea
// sale de `assignStatuses` y queda como un evento con causa en el hogar que lo recibió.

import type {
  AgentId,
  EventLog,
  HouseholdId,
  IdAllocator,
  PlaceRef,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import type { Household } from "../family/index.ts";
import type { WorldTruth } from "../world/index.ts";
import { assignStatuses, STATUS, type StatusDef } from "./status.ts";

export interface SeedStatusInput {
  readonly settlement: SettlementId;
  readonly place: PlaceRef;
  readonly now: Tick;
  readonly households: readonly Household[];
  readonly defs: readonly StatusDef[];
}

/** Escribe `STATUS` de cada vivo y devuelve el estatus de cada hogar (para repartir el patrimonio). */
export function seedStatus(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedStatusInput,
): Map<HouseholdId, StatusDef> {
  const alive = input.households.filter((h) => h.end === null);
  const assigned = assignStatuses(
    alive.map((h) => ({ id: h.id, members: h.members.length, since: h.since })),
    input.defs,
  );
  const out = new Map<HouseholdId, StatusDef>();
  for (const h of alive) {
    const a = assigned.get(h.id);
    const def = input.defs.find((d) => d.id === a?.status);
    if (!a || !def) throw new Error(`el hogar ${h.id} quedó sin estatus`);
    out.set(h.id, def);
    const event = ids.next("event");
    log.append({
      id: event,
      tick: input.now,
      kind: "social.status_set",
      actors: [...h.members],
      place: input.place,
      data: { household: h.id, status: def.id, patron: a.patron },
      emissions: {},
      causes: [{ kind: "event", event: h.origin }],
      resolution: "local",
    });
    for (const m of h.members as readonly AgentId[]) {
      truth.set(STATUS, m, {
        status: def.id,
        basis: "custom",
        patron: a.patron,
        recognizedBy: input.settlement,
        since: input.now,
        originEventId: event,
      });
    }
  }
  return out;
}
