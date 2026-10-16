// El consejo de ancianos como jurisdicción (law §3-§4, organizations §11): una acusación contada a un
// anciano del consejo de la aldea del acusado se vuelve un `Case` en el libro del foro. El foro
// pesa la denuncia con lo que creyó el oyente (la creencia y el veredicto de calumnia del evento de
// habla), y lo que el consejo pesa sobre el acusado (`councilStanding`: autoridad respetada y
// lealtad, ambas creídas o registradas) decide qué hace (`forumResponse`): descartar, mediar,
// citar o sancionar; la pena es lo que alcanza (`forumPenalty`) de la pena base del hecho citado
// (`penaltyScale` sobre lo que el anciano sabe del acusado). Por ahora el caso solo se registra
// (libro y eventos): ni investigación, ni compensación, ni efecto de la pena en el mundo. Opt-in
// (`LifeParts.councilCases`, requiere `council`); apagado no existe ni corre ni cambia hashes.

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  activeMembers,
  CASE_COOLDOWN_DAYS,
  CASES,
  type CaseBook,
  type DeedKind,
  type Denunciation,
  draftEvent,
  ENTITY,
  type EventDraft,
  forumResponse,
  HOUSEHOLD,
  isRepeat,
  KNOWN_DEEDS,
  ORG,
  ORG_LOYALTY,
  openCase,
  PERSON,
  type ProcessDef,
  penaltyScale,
  RELATIONS,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { type CouncilAuthorityOptions, councilStanding } from "./councilauthority.ts";

export const COUNCIL_CASES_PROCESS = "life.council_cases";
export const CASE_OPENED_EVENT = "law.case_opened";
export const CASE_RESOLVED_EVENT = "law.case_resolved";

export interface CouncilCasesOptions extends CouncilAuthorityOptions {
  /** Días antes de volver a abrir el mismo caso (mismo acusador, acusado y cargo). */
  readonly cooldownDays?: number;
}

export interface CouncilCasesDeps extends CouncilCasesOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  readonly day: number;
}

interface SpokenAccusation {
  readonly accused: AgentId;
  readonly deed: DeedKind;
  readonly verdict?: string;
  readonly belief?: number;
}

/** La acusación contra un tercero que dejó un evento de habla, si la oyó con creencia propia. */
function accusationOf(data: unknown): SpokenAccusation | null {
  const a = (data as { effect?: { accusation?: SpokenAccusation } }).effect?.accusation;
  if (!a || typeof a.belief !== "number" || typeof a.accused !== "string") return null;
  return a;
}

const settlementOf = (truth: ReadonlyWorldTruth, who: AgentId): string | undefined => {
  const home = truth.get(PERSON, who)?.household;
  return home === undefined ? undefined : truth.get(HOUSEHOLD, home)?.settlement;
};

export function councilCasesProcess(o: CouncilCasesDeps): ProcessDef {
  const cooldown = (o.cooldownDays ?? CASE_COOLDOWN_DAYS) * o.day;
  return {
    id: COUNCIL_CASES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "decide",
    reads: [
      ORG.name,
      ENTITY.name,
      PERSON.name,
      HOUSEHOLD.name,
      RELATIONS.name,
      ORG_LOYALTY.name,
      KNOWN_DEEDS.name,
      CASES.name,
    ],
    writes: [CASES.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const books = new Map<string, CaseBook | undefined>();
      for (const e of ctx.recent) {
        if (e.kind !== "action.speak") continue;
        const acc = accusationOf(e.data);
        const [judge, accuser] = e.actors as (AgentId | undefined)[];
        if (!acc || !judge || !accuser) continue;
        const accused = acc.accused;
        if (accused === judge || accused === accuser) continue;
        const settlement = settlementOf(truth, accused);
        if (settlement === undefined || truth.get(ENTITY, accused)?.endedAt !== undefined) continue;
        // El foro es el consejo activo de la aldea del acusado, y quien oyó es uno de sus miembros.
        const forum = [...truth.ids(ORG)].sort().find((id) => {
          const org = truth.get(ORG, id);
          return (
            org?.status === "active" &&
            org.settlement === settlement &&
            activeMembers(org).some((m) => m.agent === judge)
          );
        }) as string | undefined;
        if (forum === undefined) continue;
        const belief = acc.belief as number;
        const suspectsLiar = acc.verdict === "slander";
        const known = (truth.get(KNOWN_DEEDS, judge)?.deeds ?? []).find(
          (d) => d.by === accused && d.kind === acc.deed,
        );
        const d: Denunciation = {
          forum,
          accuser,
          accused,
          claimed: acc.deed,
          judge,
          belief,
          facts: known ? [known.event] : [],
          at: e.tick,
          origin: e.id,
        };
        const book = books.has(forum) ? books.get(forum) : truth.get(CASES, forum as never);
        if (isRepeat(book, d, cooldown)) continue;
        const standing = councilStanding(truth, accused, o);
        const response = forumResponse(belief, suspectsLiar, standing);
        const opened = openCase(book, d, response, known ? penaltyScale(known) : 1, standing);
        books.set(forum, opened.book);
        const c = opened.case;
        const openedEv = draftEvent(events.length);
        events.push({
          kind: CASE_OPENED_EVENT,
          actors: [accuser, accused, judge],
          place: o.placeOf(truth, judge),
          data: { case: c.id, forum, claimed: c.claimed, belief },
          emissions: {},
          causes: [{ kind: "event", event: e.id }],
        });
        events.push({
          kind: CASE_RESOLVED_EVENT,
          actors: [accuser, accused, judge],
          place: o.placeOf(truth, judge),
          data: {
            case: c.id,
            forum,
            response,
            status: c.status,
            ...(c.verdict ? { penalty: c.verdict.penalty } : {}),
          },
          emissions: {},
          causes: [{ kind: "event", event: openedEv }],
        });
      }
      for (const [forum, book] of [...books].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (book) changes.push(setComponent(CASES, forum as never, book));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
