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
// `law.case_effects` (causa: la resolución). Con `vendetta` (sub-opción) un caso `defied` o un acusado
// que el foro no pudo sancionar abre la decisión del acusador de cobrárselo solo con su linaje (por
// creencia y rencor, lealtad al foro), que escala por etapas acotadas y se cierra al enfriarse.
// Opt-in (`LifeParts.councilCases`, requiere `council`);
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
  appearChance,
  balanceClues,
  CASE_COOLDOWN_DAYS,
  CASES,
  type Case,
  type CaseBook,
  type CaseEffectRules,
  type Clue,
  closeVendetta,
  compensationDue,
  DEFAULT_CASE_EFFECTS,
  DEFAULT_VENDETTA_RULES,
  type DeedKind,
  type Denunciation,
  decideVendetta,
  draftEvent,
  ENTITY,
  type EventDraft,
  escalateVendetta,
  forumResponse,
  type GoodDef,
  goodUnit,
  HOUSEHOLD,
  INVESTIGATION_DAYS,
  investigationDue,
  isRepeat,
  KNOWN_DEEDS,
  loyaltyOf,
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
  resolveInvestigation,
  resolveSummons,
  type StateChange,
  SUMMONS_DAYS,
  setComponent,
  summonsPending,
  TRACE,
  testimonyWeight,
  traceStrength,
  traceVisible,
  traceWeight,
  unreachedReason,
  VENDETTA_KIN_SHARE,
  VENDETTA_RETURN,
  type Vendetta,
  type VendettaRules,
  vendettaChance,
  vendettaDue,
  vendettaPush,
} from "../../sim/index.ts";
import { type CouncilAuthorityOptions, councilStanding } from "./councilauthority.ts";

export const COUNCIL_CASES_PROCESS = "life.council_cases";
export const CASE_OPENED_EVENT = "law.case_opened";
export const CASE_RESOLVED_EVENT = "law.case_resolved";
export const CASE_EFFECTS_EVENT = "law.case_effects";
export const CASE_INVESTIGATED_EVENT = "law.case_investigated";
export const SUMMONS_ANSWERED_EVENT = "law.summons_answered";
export const SUMMONS_DEFIED_EVENT = "law.summons_defied";
export const VENDETTA_DECLARED_EVENT = "law.vendetta_declared";
export const VENDETTA_ESCALATED_EVENT = "law.vendetta_escalated";
export const VENDETTA_CLOSED_EVENT = "law.vendetta_closed";

/** Opt-in: el caso `investigating` cita al acusado y su obediencia decide si comparece. */
export interface SummonsOptions {
  /** Días de plazo para presentarse (por defecto `SUMMONS_DAYS`). */
  readonly days?: number;
  /** Piso de deber de presentarse aun sin autoridad del consejo (por defecto `SUMMONS_DUTY`). */
  readonly duty?: number;
}

/** Opt-in: el caso `investigating` reúne indicios de lo que el foro cree y ve antes de decidir. */
export interface InvestigationOptions {
  /** Días que espera un caso sin citación antes de investigarse (por defecto `INVESTIGATION_DAYS`). */
  readonly days?: number;
}

export interface CouncilCasesOptions extends CouncilAuthorityOptions {
  /** Días antes de volver a abrir el mismo caso (mismo acusador, acusado y cargo). */
  readonly cooldownDays?: number;
  /** Opt-in: la resolución mueve grano por el ledger y las relaciones de las partes (necesita `goods` y ledger). */
  readonly effects?: Partial<CaseEffectRules>;
  /** Opt-in: la citación vence y el acusado comparece o no (escala a `defied`). */
  readonly summons?: SummonsOptions;
  /** Opt-in: el caso investigando reúne indicios y testigos (creídos, no la verdad) y se resuelve. */
  readonly investigation?: InvestigationOptions;
  /** Opt-in: el acusador y su linaje se cobran solos lo que el consejo no alcanzó (law §9). */
  readonly vendetta?: Partial<{ days: number; gain: number; coolBelow: number }>;
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
    withRecent: true,
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
      TRACE.name,
    ],
    writes: o.effects || o.vendetta ? [CASES.name, RELATIONS.name] : [CASES.name],
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
      /** Lo que la resolución de un caso mueve en el mundo (con `effects`); cuelga de `resolvedEv`. */
      const applyEffects = (c: Case, resolvedEv: ReturnType<typeof draftEvent>): void => {
        const { accuser, accused, judge, forum } = c;
        const effects: { compensation?: object; resentment?: number; face?: number } = {};
        const transfers: Transfer[] = [];
        if (c.status === "decided" && c.verdict) {
          const p = c.verdict.penalty;
          const payerHome = truth.get(PERSON, accused)?.household as string | undefined;
          const payeeHome = truth.get(PERSON, accuser)?.household as string | undefined;
          if (grain && ctx.ledger && payerHome && payeeHome && payerHome !== payeeHome) {
            const from = holderAccount(payerHome as unknown as HolderRef);
            const to = holderAccount(payeeHome as unknown as HolderRef);
            const have = ctx.ledger.balance(from as never, grain as never) + (moved.get(from) ?? 0);
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
      };
      // Qué sabe cada fuente del hecho que se juzga: lo que guarda (no la verdad) y las huellas
      // visibles atadas a un hecho que ya sabe de quién es.
      const cluesOf = (c: Case): Clue[] => {
        const forumOrg = truth.get(ORG, c.forum as never);
        const sources = [
          ...(forumOrg ? activeMembers(forumOrg).map((m) => m.agent) : []),
          c.accuser,
        ]
          .filter((a, i, all) => a !== c.accused && all.indexOf(a) === i)
          .sort();
        const clues: Clue[] = [];
        for (const src of sources) {
          const deeds = (truth.get(KNOWN_DEEDS, src)?.deeds ?? []).filter(
            (d) =>
              d.kind === c.claimed &&
              (c.facts.length === 0 ? d.by === c.accused : c.facts.includes(d.event)),
          );
          for (const d of deeds) {
            clues.push({
              kind: "testimony",
              source: src,
              points: d.by,
              weight: testimonyWeight(d, src === c.accuser),
              event: d.event,
            });
            for (const tid of [...truth.ids(TRACE)].sort()) {
              const t = truth.get(TRACE, tid);
              if (!t || t.event !== d.event || d.by === null || !traceVisible(t, ctx.now)) continue;
              clues.push({
                kind: "trace",
                source: src,
                points: d.by,
                weight: traceWeight(traceStrength(t, ctx.now)),
                event: d.event,
              });
            }
          }
        }
        return clues;
      };
      // Citaciones vencidas: el citado comparece o no, según lo que el consejo pesa sobre él.
      if (o.summons) {
        for (const forum of [...truth.ids(CASES)].sort()) {
          const stored = truth.get(CASES, forum as never);
          if (!stored) continue;
          let touched = false;
          const cases: Case[] = [];
          for (const c of stored.cases) {
            if (!summonsPending(c, ctx.now)) {
              cases.push(c);
              continue;
            }
            touched = true;
            if (truth.get(ENTITY, c.accused)?.endedAt !== undefined) {
              cases.push({ ...c, status: "dropped" });
              continue;
            }
            const chance = appearChance(councilStanding(truth, c.accused, o), o.summons.duty);
            const appeared = ctx.rng.fork("summons", c.id).chance(chance);
            cases.push(resolveSummons(c, appeared, chance, ctx.now));
            events.push({
              kind: appeared ? SUMMONS_ANSWERED_EVENT : SUMMONS_DEFIED_EVENT,
              actors: [c.accuser, c.accused, c.judge],
              place: o.placeOf(truth, c.judge),
              data: { case: c.id, forum, chance, ...(appeared ? {} : { status: "defied" }) },
              emissions: {},
              causes: [{ kind: "event", event: c.originEventId }],
            });
            if (!appeared && o.effects) {
              const evId = draftEvent(events.length - 1);
              const forumOrg = truth.get(ORG, forum as never);
              let face = 0;
              for (const m of forumOrg ? activeMembers(forumOrg) : []) {
                if (m.agent === c.accused || m.agent === c.accuser) continue;
                face += tweak(m.agent, c.accused, "respect", -rules.defianceFaceDrop, -1);
              }
              if (face !== 0) {
                events.push({
                  kind: CASE_EFFECTS_EVENT,
                  actors: [c.accuser, c.accused, c.judge],
                  place: o.placeOf(truth, c.judge),
                  data: { case: c.id, forum, status: "defied", face: Math.round(face * 1e6) / 1e6 },
                  emissions: {},
                  causes: [{ kind: "event", event: evId }],
                });
              }
            }
          }
          if (touched) books.set(forum, { ...stored, cases });
        }
      }
      // Investigación: el caso reúne indicios de lo que el foro cree y ve, corrige su creencia y decide.
      if (o.investigation) {
        const wait = (o.investigation.days ?? INVESTIGATION_DAYS) * o.day;
        for (const forum of [...truth.ids(CASES)].sort()) {
          const stored = books.has(forum) ? books.get(forum) : truth.get(CASES, forum as never);
          if (!stored) continue;
          let touched = false;
          const cases: Case[] = [];
          for (const c of stored.cases) {
            if (!investigationDue(c, ctx.now, wait)) {
              cases.push(c);
              continue;
            }
            touched = true;
            if (truth.get(ENTITY, c.accused)?.endedAt !== undefined) {
              cases.push({ ...c, status: "dropped" });
              continue;
            }
            const clues = cluesOf(c);
            const balance = balanceClues(clues, c.accused);
            const known = (truth.get(KNOWN_DEEDS, c.judge)?.deeds ?? []).find(
              (d) => c.facts[0] !== undefined && d.event === c.facts[0],
            );
            const done = resolveInvestigation(
              c,
              balance,
              councilStanding(truth, c.accused, o),
              known ? penaltyScale(known) : 1,
              ctx.now,
            );
            cases.push(done);
            const place = o.placeOf(truth, c.judge);
            const invEv = draftEvent(events.length);
            events.push({
              kind: CASE_INVESTIGATED_EVENT,
              actors: [c.accuser, c.accused, c.judge],
              place,
              data: {
                case: c.id,
                forum,
                clues: balance.clues,
                for: balance.for,
                against: balance.against,
                beliefBefore: c.belief,
                beliefAfter: done.investigation?.beliefAfter ?? c.belief,
                witnesses: [...new Set(clues.map((x) => x.source))],
              },
              emissions: {},
              causes: [{ kind: "event", event: c.originEventId }],
            });
            events.push({
              kind: CASE_RESOLVED_EVENT,
              actors: [c.accuser, c.accused, c.judge],
              place,
              data: {
                case: c.id,
                forum,
                response: "investigated",
                status: done.status,
                ...(done.verdict ? { penalty: done.verdict.penalty } : {}),
              },
              emissions: {},
              causes: [{ kind: "event", event: invEv }],
            });
            if (o.effects) applyEffects(done, draftEvent(events.length - 1));
          }
          if (touched) books.set(forum, { ...stored, cases });
        }
      }
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
        const opened = openCase(
          book,
          d,
          response,
          known ? penaltyScale(known) : 1,
          standing,
          o.summons ? e.tick + (o.summons.days ?? SUMMONS_DAYS) * o.day : undefined,
        );
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
            ...(c.summons ? { summonsDue: c.summons.due } : {}),
          },
          emissions: {},
          causes: [{ kind: "event", event: openedEv }],
        });
        if (o.effects) applyEffects(c, draftEvent(events.length - 1));
      }
      // Vendettas: donde el consejo no alcanzó al acusado, el acusador y su linaje deciden si se la cobran.
      if (o.vendetta) {
        const vr: VendettaRules = {
          escalationDays: o.vendetta.days ?? DEFAULT_VENDETTA_RULES.escalationDays,
          gain: o.vendetta.gain ?? DEFAULT_VENDETTA_RULES.gain,
          coolBelow: o.vendetta.coolBelow ?? DEFAULT_VENDETTA_RULES.coolBelow,
        };
        const wait = vr.escalationDays * o.day;
        const alive = (a: AgentId) => truth.get(ENTITY, a)?.endedAt === undefined;
        const kinOf = (c: Case): AgentId[] => {
          const home = truth.get(PERSON, c.accuser)?.household;
          const members = home === undefined ? [] : (truth.get(HOUSEHOLD, home)?.members ?? []);
          return members.filter((m) => m !== c.accuser && m !== c.accused && alive(m)).sort();
        };
        for (const forum of [...truth.ids(CASES)].sort()) {
          const stored = books.has(forum) ? books.get(forum) : truth.get(CASES, forum as never);
          if (!stored) continue;
          let touched = false;
          const cases: Case[] = [];
          for (const c of stored.cases) {
            const reason = unreachedReason(c);
            const place = o.placeOf(truth, c.judge);
            if (reason !== null && alive(c.accused) && alive(c.accuser)) {
              touched = true;
              const chance = vendettaChance({
                belief: c.belief,
                resentment: rowOf(c.accuser)?.toward[c.accused as string]?.dims.resentment ?? 0,
                loyalty: loyaltyOf(truth.get(ORG_LOYALTY, forum as never), c.accuser),
                reason,
              });
              const declare = ctx.rng.fork("vendetta", c.id).chance(chance);
              const kin = kinOf(c);
              const next = decideVendetta(c, reason, declare, chance, kin, ctx.now);
              cases.push(next);
              if (declare) {
                const push = vendettaPush(1, vr.gain);
                tweak(c.accuser, c.accused, "resentment", push, 0);
                tweak(c.accused, c.accuser, "resentment", push * VENDETTA_RETURN, 0);
                for (const k of next.vendetta?.kin ?? [])
                  tweak(k, c.accused, "resentment", push * VENDETTA_KIN_SHARE, 0);
                events.push({
                  kind: VENDETTA_DECLARED_EVENT,
                  actors: [c.accuser, c.accused],
                  place,
                  data: { case: c.id, forum, reason, chance, kin: next.vendetta?.kin ?? [] },
                  emissions: {},
                  causes: [{ kind: "event", event: c.originEventId }],
                });
              }
              continue;
            }
            if (!vendettaDue(c, ctx.now, wait)) {
              cases.push(c);
              continue;
            }
            touched = true;
            const v = c.vendetta as Vendetta;
            const grudge = rowOf(c.accuser)?.toward[c.accused as string]?.dims.resentment ?? 0;
            const gone = !alive(c.accused) || !alive(c.accuser);
            const next = gone
              ? closeVendetta(c, ctx.now)
              : escalateVendetta(c, grudge, ctx.now, vr.coolBelow);
            cases.push(next);
            const stage = next.vendetta?.stage ?? v.stage;
            const closed = next.vendetta?.status === "closed";
            if (!closed) {
              const push = vendettaPush(1, vr.gain);
              tweak(c.accuser, c.accused, "resentment", push, 0);
              tweak(c.accused, c.accuser, "resentment", push * VENDETTA_RETURN, 0);
              for (const k of v.kin) {
                if (alive(k)) tweak(k, c.accused, "resentment", push * VENDETTA_KIN_SHARE, 0);
              }
            }
            events.push({
              kind: closed ? VENDETTA_CLOSED_EVENT : VENDETTA_ESCALATED_EVENT,
              actors: [c.accuser, c.accused],
              place,
              data: { case: c.id, forum, stage, grudge, ...(closed ? { gone } : {}) },
              emissions: {},
              causes: [{ kind: "event", event: c.originEventId }],
            });
          }
          if (touched) books.set(forum, { ...stored, cases });
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
