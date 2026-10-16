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
  activeMembers,
  admitMember,
  type CouncilRules,
  chooseElders,
  DEFAULT_COUNCIL_RULES,
  draftEvent,
  type ElderCandidate,
  ENTITY,
  type EventDraft,
  electHead,
  fillHead,
  foundCouncil,
  HEAD_POSITION,
  HOUSEHOLD,
  headClaim,
  headVacant,
  isMember,
  ORG,
  type Organization,
  oldestVacancy,
  openSeats,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  type StateChange,
  type SuccessionCandidate,
  setComponent,
  withdrawMember,
} from "../../sim/index.ts";

export const COUNCIL_PROCESS = "life.council";
export const ORG_FOUNDED_EVENT = "org.founded";
export const ORG_MEMBER_LEFT_EVENT = "org.member_left";
export const ORG_POSITION_FILLED_EVENT = "org.position_filled";
export const ORG_MEMBER_JOINED_EVENT = "org.member_joined";

/**
 * El respeto que la aldea le tiene a `who`: lo que sus vecinos sienten de verdad (RELATIONS,
 * `respect` positivo, tal cual guardado) sumado y dividido por los otros vecinos, tope 1. Sin
 * relaciones registradas pesa 0.
 */
export function communityRespect(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  peers: readonly AgentId[],
): number {
  let sum = 0;
  let n = 0;
  for (const p of peers) {
    if (p === who) continue;
    n++;
    sum += Math.max(0, truth.get(RELATIONS, p)?.toward[who as string]?.dims.respect ?? 0);
  }
  return n === 0 ? 0 : Math.min(1, Math.round((sum / n) * 1e6) / 1e6);
}

export interface CouncilOptions {
  /** Reglas del consejo (asientos, edad mínima, mínimo para fundar); por defecto `DEFAULT_COUNCIL_RULES`. */
  readonly rules?: Partial<CouncilRules>;
  /** Respeto creído (0-1) que la aldea le tiene a alguien; sin esto cuenta solo la edad. */
  readonly respectOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** `"relations"`: el respeto sale de RELATIONS (`communityRespect`); `respectOf` tiene prioridad. */
  readonly respect?: "relations";
  /** `false` apaga la sucesión del cabeza y la reposición de asientos (queda solo la fundación y las salidas). */
  readonly succession?: boolean;
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
    reads: [ORG.name, ENTITY.name, PERSON.name, HOUSEHOLD.name, RELATIONS.name],
    writes: [ORG.name, ENTITY.name],
    run(ctx) {
      const truth = ctx.truth;
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const founded = new Set<string>();
      const updated = new Map<string, { before: Organization; after: Organization }>();

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
        updated.set(id, { before: org, after: next });
      }

      // Gente viva de los hogares vivos, por asentamiento.
      const peopleOf = new Map<SettlementId, AgentId[]>();
      for (const hid of [...truth.ids(HOUSEHOLD)].sort()) {
        const h = truth.get(HOUSEHOLD, hid);
        if (!h) continue;
        if (truth.get(ENTITY, hid)?.endedAt !== undefined) continue;
        for (const who of h.members) {
          if (!truth.get(PERSON, who) || !alive(who)) continue;
          const list = peopleOf.get(h.settlement) ?? [];
          list.push(who);
          peopleOf.set(h.settlement, list);
        }
      }
      const respectIn = (who: AgentId, settlement: SettlementId): number | undefined =>
        o.respectOf
          ? o.respectOf(truth, who)
          : o.respect === "relations"
            ? communityRespect(truth, who, peopleOf.get(settlement) ?? [])
            : undefined;
      const candidate = (who: AgentId, settlement: SettlementId): ElderCandidate => {
        const respect = respectIn(who, settlement);
        return {
          agent: who,
          ageYears: (ctx.now - (truth.get(PERSON, who)?.born ?? ctx.now)) / o.year,
          ...(respect !== undefined ? { respect } : {}),
        };
      };

      // Sucesión: el cabeza vacante lo ocupa el miembro con más legitimidad y los asientos que
      // dejó la muerte los reponen nuevos ancianos (cooptados). Solo con `succession`.
      if (o.succession !== false) {
        for (const [id, u] of updated) {
          const org = u.after;
          if (org.status !== "active") continue;
          let next = org;
          const people = peopleOf.get(org.settlement) ?? [];
          if (headVacant(next)) {
            const info = new Map<AgentId, SuccessionCandidate>();
            for (const m of activeMembers(next))
              info.set(m.agent, candidate(m.agent, org.settlement));
            const who = electHead(next, info, ctx.now, o.year);
            if (who !== null) {
              const vac = next.positions.find((p) => p.id === HEAD_POSITION);
              const ev = draftEvent(events.length);
              const prev = next;
              next = fillHead(next, who, ctx.now, ev);
              events.push({
                kind: ORG_POSITION_FILLED_EVENT,
                actors: [who],
                place: o.placeOf(truth, who),
                data: {
                  org: id,
                  position: HEAD_POSITION,
                  agent: who,
                  claim: headClaim(
                    activeMembers(prev).find((m) => m.agent === who) as never,
                    info.get(who) as SuccessionCandidate,
                    ctx.now,
                    o.year,
                  ),
                },
                emissions: {},
                causes: vac?.vacatedBy ? [{ kind: "event", event: vac.vacatedBy }] : [],
              });
            }
          }
          let seats = openSeats(next, rules);
          if (seats > 0) {
            const members = new Set(activeMembers(next).map((m) => m.agent as string));
            const pool = chooseElders(
              people.filter((p) => !members.has(p)).map((p) => candidate(p, org.settlement)),
              { ...rules, seats, minSeats: 1 },
            );
            for (const c of pool) {
              if (seats-- <= 0) break;
              const seat = oldestVacancy(next);
              const ev = draftEvent(events.length);
              next = admitMember(next, c.agent, ctx.now, ev);
              events.push({
                kind: ORG_MEMBER_JOINED_EVENT,
                actors: [c.agent],
                place: o.placeOf(truth, c.agent),
                data: { org: id, agent: c.agent, via: "coopted", replaces: seat?.agent },
                emissions: {},
                causes: seat?.exitEventId ? [{ kind: "event", event: seat.exitEventId }] : [],
              });
            }
          }
          u.after = next;
        }
      }
      for (const [id, u] of updated)
        if (u.after !== u.before) changes.push(setComponent(ORG, id as never, u.after));

      // Fundación: asentamientos con gente y sin consejo.
      for (const settlement of [...peopleOf.keys()].sort()) {
        if (founded.has(settlement)) continue;
        const elders = chooseElders(
          (peopleOf.get(settlement) ?? []).map((p) => candidate(p, settlement)),
          rules,
        );
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
