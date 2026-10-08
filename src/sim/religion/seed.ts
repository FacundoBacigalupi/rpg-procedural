// La religión de la aldea al empezar (religion §16 Fase 1): sale de `content/religions/` y queda
// como una fila por asentamiento con su evento de origen, que cuelga de la fundación. Lo que
// cree la gente no toca `WorldTruth`: sembrar la religión no crea espíritus ni dioses.

import type {
  EventId,
  EventLog,
  IdAllocator,
  PlaceRef,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import { type ReadonlyWorldTruth, table, type WorldTruth } from "../world/index.ts";
import {
  type DoctrineDef,
  type PracticeDef,
  type PracticeKind,
  type ReligionDef,
  religionProblems,
  type SacredBeingDef,
} from "./religion.ts";

export interface CommunityReligion {
  readonly religion: string;
  readonly name: string;
  readonly kind: ReligionDef["kind"];
  readonly doctrines: readonly string[];
  readonly sacredBeings: readonly SacredBeingDef[];
  readonly practices: readonly PracticeDef[];
  readonly adherence: ReligionDef["adherence"];
  readonly exclusive: boolean;
  readonly because: string;
  readonly originEventId: EventId;
}

export const COMMUNITY_RELIGION = table<CommunityReligion>("religion.community");

export interface SeedReligionInput {
  readonly settlement: SettlementId;
  readonly place: PlaceRef;
  readonly now: Tick;
  readonly foundersEvent: EventId;
  readonly religion: ReligionDef;
  readonly doctrines: readonly DoctrineDef[];
}

/** Escribe la religión de la aldea. Falla fuerte si el contenido no cierra. */
export function seedReligion(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedReligionInput,
): CommunityReligion {
  const r = input.religion;
  const problems = religionProblems(r);
  for (const d of r.doctrines) {
    if (!input.doctrines.some((x) => x.id === d)) {
      problems.push(`${r.id}: no existe la doctrina ${d}`);
    }
  }
  if (problems.length > 0) throw new Error(`religión inválida: ${problems.join("; ")}`);
  const event = ids.next("event");
  log.append({
    id: event,
    tick: input.now,
    kind: "religion.seeded",
    actors: [],
    place: input.place,
    data: {
      religion: r.id,
      doctrines: r.doctrines.length,
      beings: r.sacredBeings.length,
      practices: r.practices.length,
    },
    emissions: null,
    causes: [{ kind: "event", event: input.foundersEvent }],
    resolution: "history",
  });
  const community: CommunityReligion = {
    religion: r.id,
    name: r.name,
    kind: r.kind,
    doctrines: r.doctrines,
    sacredBeings: r.sacredBeings,
    practices: r.practices,
    adherence: r.adherence,
    exclusive: r.exclusive,
    because: r.because,
    originEventId: event,
  };
  truth.set(COMMUNITY_RELIGION, input.settlement, community);
  return community;
}

/** La religión de la aldea de la vida (hoy hay una sola comunidad). */
export function villageReligion(truth: ReadonlyWorldTruth): CommunityReligion | undefined {
  const [first] = truth.ids(COMMUNITY_RELIGION);
  return first === undefined ? undefined : truth.get(COMMUNITY_RELIGION, first);
}

/** Las prácticas de un tipo (ofrendas, tabúes, fiestas…), en el orden del contenido. */
export function practicesOfKind(
  religion: CommunityReligion | undefined,
  kind: PracticeKind,
): readonly PracticeDef[] {
  return religion?.practices.filter((p) => p.kind === kind) ?? [];
}

/** El tabú que alcanza a un bien, si hay uno. Lo lee la sanción creída (Fase 2). */
export function tabooOnGood(
  religion: CommunityReligion | undefined,
  good: string,
): PracticeDef | undefined {
  return practicesOfKind(religion, "taboo").find((p) => p.goods.includes(good));
}
