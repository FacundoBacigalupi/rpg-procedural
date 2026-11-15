// Las ofensas entre sectas (novel4-grievance-record, organizations §10): cuando alguien de una
// secta sabe que uno de otra secta con la que la suya tiene relación le robó, le pegó o mató a uno
// de los suyos (lo sabe como hecho con autor, `KNOWN_DEEDS`), la secta lo guarda como ofensa contra
// la otra (`addGrievance`): el hecho entra a `grievances` y el rencor sube según su peso. Una vez
// por hecho; queda el evento `org.grievance`, causado por el hecho.
//
// Corre una vez por día: una secta se entera de lo que saben los suyos sin apuro. Que la secta
// responda (exigir reparación, represalia, olvidar) viene con novel4-grievance-matter.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type PlaceId,
} from "../../core/index.ts";
import {
  addGrievance,
  BODY_STATE,
  ENTITY,
  type EventDraft,
  type GrievanceKind,
  KNOWN_DEEDS,
  ORG_GRIEVANCE_EVENT,
  ORG_RELATION,
  type OrgRelations,
  orgTie,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SECT,
  SECT_MEMBER,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const SECT_GRIEVANCE_PROCESS = "life.sect_grievance";

/** Una ofensa que la secta `org` todavía no guarda contra `against`. */
export interface SectGrievance {
  readonly org: EntityRef;
  readonly against: EntityRef;
  readonly event: EventId;
  readonly kind: GrievanceKind;
  readonly by: AgentId;
  readonly victim: AgentId;
  /** Quién de la secta lo sabe (el primero por id). */
  readonly knower: AgentId;
}

function dead(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  if (truth.get(ENTITY, id)?.endedAt !== undefined) return true;
  return (truth.get(BODY_STATE, id)?.death ?? null) !== null;
}

/**
 * Las ofensas nuevas (puro): de lo que saben los miembros vivos de cada secta, los hechos con autor
 * conocido contra uno de la misma secta, cometidos por uno de una secta con la que la suya tiene
 * relación. Robo, agresión o muerte (la agresión cuenta como muerte si la víctima ya no vive).
 * Ordenadas por secta y por hecho; una por par de sectas y hecho.
 */
export function newGrievances(truth: ReadonlyWorldTruth): SectGrievance[] {
  const found = new Map<string, SectGrievance>();
  for (const knower of [...truth.ids(SECT_MEMBER)].sort(compareStrings) as AgentId[]) {
    if (dead(truth, knower)) continue;
    const org = truth.get(SECT_MEMBER, knower)?.org;
    if (org === undefined) continue;
    const relations = truth.get(ORG_RELATION, org);
    if (!relations) continue;
    for (const d of truth.get(KNOWN_DEEDS, knower)?.deeds ?? []) {
      if (d.by === null || (d.kind !== "theft" && d.kind !== "assault")) continue;
      if (truth.get(SECT_MEMBER, d.victim)?.org !== org) continue;
      const against = truth.get(SECT_MEMBER, d.by)?.org;
      if (against === undefined || against === org) continue;
      const tie = orgTie(relations, against);
      if (!tie || tie.grievances.includes(d.event)) continue;
      const key = `${org}|${against}|${d.event}`;
      if (found.has(key)) continue;
      const kind: GrievanceKind =
        d.kind === "theft" ? "theft" : dead(truth, d.victim) ? "killing" : "assault";
      found.set(key, { org, against, event: d.event, kind, by: d.by, victim: d.victim, knower });
    }
  }
  return [...found.values()].sort(
    (a, b) => compareStrings(a.org, b.org) || compareStrings(a.event, b.event),
  );
}

/** Escritor de `ORG_RELATION`: las sectas guardan las ofensas que saben los suyos (cableado opt-in). */
export function sectGrievanceProcess(): ProcessDef {
  return {
    id: SECT_GRIEVANCE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      SECT_MEMBER.name,
      KNOWN_DEEDS.name,
      ORG_RELATION.name,
      ENTITY.name,
      BODY_STATE.name,
      SECT.name,
    ],
    writes: [ORG_RELATION.name],
    run(ctx) {
      const truth = ctx.truth;
      const found = newGrievances(truth);
      if (found.length === 0) return {};
      const relations = new Map<EntityRef, OrgRelations>();
      const events: EventDraft[] = [];
      for (const g of found) {
        const had = relations.get(g.org) ?? truth.get(ORG_RELATION, g.org);
        const tie = orgTie(had, g.against);
        // La ofensa se guarda en la sede (sin sede no hay secta que la guarde).
        const seat = truth.get(SECT, g.org)?.seatPlace;
        if (!had || !tie || seat === undefined) continue;
        relations.set(g.org, {
          toward: { ...had.toward, [g.against]: addGrievance(tie, g.event, g.kind) },
        });
        events.push({
          kind: ORG_GRIEVANCE_EVENT,
          actors: [g.by, g.victim, g.knower],
          place: { kind: "place", place: seat as unknown as PlaceId },
          data: { org: g.org, against: g.against, kind: g.kind, deed: g.event },
          emissions: {},
          causes: [{ kind: "event", event: g.event }],
        });
      }
      const changes: StateChange[] = [...relations]
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([id, r]) => setComponent(ORG_RELATION, id, r));
      return { changes, events };
    },
  };
}
