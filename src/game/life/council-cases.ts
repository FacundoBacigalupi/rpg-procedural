// El consejo de ancianos como jurisdicción (law §3-§4, organizations §11): una acusación contada a un
// anciano del consejo de la aldea del acusado se vuelve un `Case` en el libro del foro. El foro
// pesa la denuncia con lo que creyó el oyente (la creencia y el veredicto de calumnia del evento de
// habla), y lo que el consejo pesa sobre el acusado (`councilStanding`: autoridad respetada y
// lealtad, ambas creídas o registradas) decide qué hace (`forumResponse`): descartar, mediar,
// citar o sancionar; la pena es lo que alcanza (`forumPenalty`) de la pena base del hecho citado
// (`penaltyScale` sobre lo que el anciano sabe del acusado). Por ahora el caso solo se registra
// (libro y eventos). Con `effects` (sub-opción) la resolución también mueve el mundo: la sanción hace
// pagar al hogar del acusado una compensación en grano al hogar de quien acusó, por el ledger (solo lo
// que tiene: conservación), sube su rencor hacia el acusador y le baja el respeto que le tienen los
// miembros del consejo (cara); la mediación baja el rencor entre las partes. Todo con el evento
// `law.case_effects` (causa: la resolución). Opt-in (`LifeParts.councilCases`, requiere `council`);
// apagado no existe ni corre ni cambia hashes.

import {
  type AgentId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type Transfer,
} from "../../core/index.ts";
import {
  activeMembers,
  CASE_COOLDOWN_DAYS,
  CASES,
  type CaseBook,
  type CaseEffectRules,
  compensationDue,
  DEFAULT_CASE_EFFECTS,
  type DeedKind,
  type Denunciation,
  draftEvent,
  ENTITY,
  type EventDraft,
  forumResponse,
  type GoodDef,
  goodUnit,
  HOUSEHOLD,
  isRepeat,
  KNOWN_DEEDS,
  nudgeDim,
  ORG,
  ORG_LOYALTY,
  openCase,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  penaltyScale,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relations,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { type CouncilAuthorityOptions, councilStanding } from "./councilauthority.ts";

export const COUNCIL_CASES_PROCESS = "life.council_cases";
export const CASE_OPENED_EVENT = "law.case_opened";
export const CASE_RESOLVED_EVENT = "law.case_resolved";
export const CASE_EFFECTS_EVENT = "law.case_effects";

export interface CouncilCasesOptions extends CouncilAuthorityOptions {
  /** Días antes de volver a abrir el mismo caso (mismo acusador, acusado y cargo). */
  readonly cooldownDays?: number;
  /** Opt-in: la resolución mueve grano por el ledger y las relaciones de las partes (necesita `goods` y ledger). */
  readonly effects?: Partial<CaseEffectRules>;
}

export interface CouncilCasesDeps extends CouncilCasesOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  readonly day: number;
  readonly goods?: readonly GoodDef[];
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
    writes: o.effects ? [CASES.name, RELATIONS.name] : [CASES.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const rules: CaseEffectRules = { ...DEFAULT_CASE_EFFECTS, ...o.effects };
      const grain = o.effects
        ? (o.goods ?? []).filter((g) => g.id === "grain").map(goodUnit)[0]
        : undefined;
      // Saldos con lo ya asentado en esta corrida y filas de relación ya cambiadas (varios casos por pasada).
      const moved = new Map<string, number>();
      const rows = new Map<string, Relations>();
      const rowOf = (who: AgentId): Relations | undefined =>
        rows.get(who) ?? truth.get(RELATIONS, who);
      /** Mueve una dimensión de lo que `from` siente hacia `to`; devuelve el cambio efectivo. */
      const tweak = (
        from: AgentId,
        to: AgentId,
        dim: "resentment" | "respect",
        delta: number,
        lo: number,
      ): number => {
        const row = rowOf(from);
        const r = row?.toward[to as string];
        if (!row || !r) return 0;
        const before = r.dims[dim] ?? 0;
        const after = nudgeDim(before, delta, lo, 1);
        if (after === before) return 0;
        rows.set(from, {
          ...row,
          toward: {
            ...row.toward,
            [to]: { ...r, dims: { ...r.dims, [dim]: after }, updated: ctx.now },
          },
        });
        return after - before;
      };
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
        if (o.effects) {
          const resolvedEv = draftEvent(events.length - 1);
          const effects: { compensation?: object; resentment?: number; face?: number } = {};
          const transfers: Transfer[] = [];
          if (c.status === "decided" && c.verdict) {
            const p = c.verdict.penalty;
            const payerHome = truth.get(PERSON, accused)?.household as string | undefined;
            const payeeHome = truth.get(PERSON, accuser)?.household as string | undefined;
            if (grain && ctx.ledger && payerHome && payeeHome && payerHome !== payeeHome) {
              const from = holderAccount(payerHome as unknown as HolderRef);
              const to = holderAccount(payeeHome as unknown as HolderRef);
              const have =
                ctx.ledger.balance(from as never, grain as never) + (moved.get(from) ?? 0);
              const amount = compensationDue(p, rules.fineGrams, have);
              if (amount > 0) {
                transfers.push({ from, to, unit: grain, amount });
                moved.set(from, (moved.get(from) ?? 0) - amount);
                effects.compensation = { from: payerHome, to: payeeHome, unit: grain, amount };
              }
            }
            const anger = tweak(accused, accuser, "resentment", rules.resentmentGain * p, 0);
            if (anger !== 0) effects.resentment = anger;
            const forumOrg = truth.get(ORG, forum as never);
            let face = 0;
            for (const m of forumOrg ? activeMembers(forumOrg) : []) {
              if (m.agent === accused || m.agent === accuser) continue;
              face += tweak(m.agent, accused, "respect", -rules.faceDrop * p, -1);
            }
            if (face !== 0) effects.face = Math.round(face * 1e6) / 1e6;
          } else if (c.status === "settled") {
            const calmed =
              tweak(accused, accuser, "resentment", -rules.mediationDrop, 0) +
              tweak(accuser, accused, "resentment", -rules.mediationDrop, 0);
            if (calmed !== 0) effects.resentment = Math.round(calmed * 1e6) / 1e6;
          }
          if (Object.keys(effects).length > 0) {
            const effEv = draftEvent(events.length);
            events.push({
              kind: CASE_EFFECTS_EVENT,
              actors: [accuser, accused, judge],
              place: o.placeOf(truth, judge),
              data: { case: c.id, forum, status: c.status, ...effects },
              emissions: {},
              causes: [{ kind: "event", event: resolvedEv }],
            });
            if (transfers.length > 0) postings.push({ event: effEv, transfers });
          }
        }
      }
      for (const [forum, book] of [...books].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (book) changes.push(setComponent(CASES, forum as never, book));
      }
      for (const [who, row] of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
        changes.push(setComponent(RELATIONS, who as never, row));
      return changes.length === 0
        ? {}
        : { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}
