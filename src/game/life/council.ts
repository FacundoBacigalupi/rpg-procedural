// Consejo de aldea 1 (organizations §11 «Nacimiento», «Familia que acumula» / aldea): el módulo puro
// `sim/org` cableado a la vida. Cada día de mundo, por cada asentamiento con hogares vivos que
// todavía no tiene consejo, se eligen sus ancianos reales (los de más edad y respeto de sus hogares)
// y, si llegan al mínimo, se funda una entidad `org:n` con `ORG`: evento `org.founded` (causa: la
// fundación del asentamiento), `originEventId` = ese evento, fundadores, membresía y puestos. Cuando
// un miembro muere se cierra su membresía y el puesto queda vacante (`org.member_left`, causa: su
// muerte). Todavía no decide nada (ni reparte, ni defiende, ni cobra): eso es «Consejo de aldea
// 2-5» del ROADMAP. Opt-in (`LifeParts.council`); apagado no existe ni corre ni cambia hashes.

import type { AgentId, EntityRef, EventId, PlaceRef, SettlementId } from "../../core/index.ts";
import {
  type CouncilRules,
  chooseElders,
  DEFAULT_COUNCIL_RULES,
  draftEvent,
  type ElderCandidate,
  ENTITY,
  type EventDraft,
  foundCouncil,
  HOUSEHOLD,
  isMember,
  ORG,
  type Organization,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  withdrawMember,
} from "../../sim/index.ts";

export const COUNCIL_PROCESS = "life.council";
export const ORG_FOUNDED_EVENT = "org.founded";
export const ORG_MEMBER_LEFT_EVENT = "org.member_left";

export interface CouncilOptions {
  /** Reglas del consejo (asientos, edad mínima, mínimo para fundar); por defecto `DEFAULT_COUNCIL_RULES`. */
  readonly rules?: Partial<CouncilRules>;
  /** Respeto creído (0-1) que la aldea le tiene a alguien; sin esto cuenta solo la edad. */
  readonly respectOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** Ticks por día de mundo. */
  readonly day: number;
  /** Ticks por año de mundo (para la edad). */
  readonly year: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los consejos existentes, en orden de id. */
export function councilRows(truth: ReadonlyWorldTruth): { id: string; org: Organization }[] {
  return [...truth.ids(ORG)]
    .sort()
    .map((id) => ({ id: id as string, org: truth.get(ORG, id) as Organization }));
}

export function councilProcess(o: CouncilOptions): ProcessDef {
  const rules: CouncilRules = { ...DEFAULT_COUNCIL_RULES, ...o.rules };
  return {
    id: COUNCIL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [ORG.name, ENTITY.name, PERSON.name, HOUSEHOLD.name],
    writes: [ORG.name, ENTITY.name],
    run(ctx) {
      const truth = ctx.truth;
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const founded = new Set<string>();

      // Salidas por muerte de los consejos que ya existen.
      for (const { id, org } of councilRows(truth)) {
        founded.add(org.settlement);
        let next = org;
        for (const m of org.members) {
          if (m.until !== undefined || alive(m.agent)) continue;
          const dead = truth.get(ENTITY, m.agent);
          const cause = dead?.endEventId ?? org.originEventId;
          next = withdrawMember(next, m.agent, {
            at: dead?.endedAt ?? ctx.now,
            kind: "death",
            event: cause,
          });
          events.push({
            kind: ORG_MEMBER_LEFT_EVENT,
            actors: [m.agent],
            place: o.placeOf(truth, m.agent),
            data: { org: id, agent: m.agent, exit: "death", status: next.status },
            emissions: {},
            causes: [{ kind: "event", event: cause }],
          });
        }
        if (next !== org) changes.push(setComponent(ORG, id as never, next));
      }

      // Candidatos por asentamiento: gente viva de los hogares vivos.
      const bySettlement = new Map<SettlementId, ElderCandidate[]>();
      for (const hid of [...truth.ids(HOUSEHOLD)].sort()) {
        const h = truth.get(HOUSEHOLD, hid);
        if (!h || founded.has(h.settlement)) continue;
        if (truth.get(ENTITY, hid)?.endedAt !== undefined) continue;
        for (const who of h.members) {
          const person = truth.get(PERSON, who);
          if (!person || !alive(who)) continue;
          const list = bySettlement.get(h.settlement) ?? [];
          list.push({
            agent: who,
            ageYears: (ctx.now - person.born) / o.year,
            ...(o.respectOf ? { respect: o.respectOf(truth, who) } : {}),
          });
          bySettlement.set(h.settlement, list);
        }
      }
      for (const settlement of [...bySettlement.keys()].sort()) {
        const elders = chooseElders(bySettlement.get(settlement) ?? [], rules);
        if (elders.length === 0) continue;
        const orgId = ctx.newId("org");
        const origin = draftEvent(events.length);
        const org = foundCouncil({
          id: orgId,
          settlement,
          elders,
          originEventId: origin,
          at: ctx.now,
        });
        const settled = truth.get(ENTITY, settlement as unknown as EntityRef)?.originEventId;
        changes.push(
          setComponent(
            ENTITY,
            orgId as never,
            {
              id: orgId,
              originEventId: origin,
              createdAt: ctx.now,
            } as never,
          ),
          setComponent(ORG, orgId as never, org),
        );
        events.push({
          kind: ORG_FOUNDED_EVENT,
          actors: org.founders as AgentId[],
          place: o.placeOf(truth, org.founders[0] as AgentId),
          data: {
            org: orgId,
            template: org.template,
            settlement,
            head: elders[0]?.agent,
            members: org.founders.length,
          },
          emissions: {},
          causes: settled ? [{ kind: "event", event: settled as EventId }] : [],
        });
      }

      return changes.length === 0 && events.length === 0 ? {} : { changes, events };
    },
  };
}

/** ¿Es `who` miembro activo de algún consejo? (lectura para otros módulos). */
export function inAnyCouncil(truth: ReadonlyWorldTruth, who: AgentId): boolean {
  return councilRows(truth).some((r) => isMember(r.org, who));
}
