// Proyectos cooperativos de la aldea (schemes §9; opt-in `LifeOptions.coop`, requiere `council`): el
// cabeza del consejo arma una obra común (un canal: `Project` de `sim/schemes`, entidad `project:n`
// con `COOP`), invita de a poco a los adultos, cada uno decide sumarse sobre lo que cree (confianza
// en el líder, rasgo de cooperar, respeto), cuenta lo que sabe del plan (`knownPlan`, compartimentado
// según la confianza) y aporta grano de SU hogar al pool por el ledger (cuenta del proyecto: lo
// aportado sale del hogar, nunca se crea). Cada paso financiado gasta del pool hacia el lugar de la
// obra; el líder vigila y sanciona a los free riders, los que ven injusto el reparto se van, y al
// terminar el saldo vuelve a los hogares (éxito: según `shareRule`; fracaso: reintegro por aporte).
// Todo con evento y `causes`. Apagado no existe ni corre. Constantes sin calibrar. Pendiente:
// caravanas, traición desde adentro (coop-betrayal), agregado/persistencia (coop-lod).

import {
  type AgentId,
  type EventId,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlaceRef,
  type Transfer,
} from "../../core/index.ts";
import {
  actualShare,
  addParticipant,
  advanceStep,
  type BondDef,
  type ContributorView,
  type CoopKind,
  clampTemper,
  contribute,
  contributionFraction,
  coordinationFailures,
  type DimensionDef,
  decideJoin,
  detectFreeRiders,
  distributePool,
  draftEvent,
  ENTITY,
  type EventDraft,
  endProject,
  freeRiderFraction,
  HEAD_POSITION,
  INNATE,
  type InviteeView,
  LEAVE_THRESHOLD,
  leavePressure,
  leaveProject,
  makeProject,
  ORG,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type Project,
  projectCauses,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  type ShareRule,
  type StateChange,
  sanctionFreeRider,
  setComponent,
  settleProject,
  shareCommitment,
  standardize,
  type Trait,
  table,
  tellPlan,
} from "../../sim/index.ts";
import { COMMITMENTS } from "./loans.ts";

export const COOP_PROCESS = "life.coop";
export const COOP_FOUNDED_EVENT = "coop.founded";
export const COOP_JOINED_EVENT = "coop.joined";
export const COOP_CONTRIBUTED_EVENT = "coop.contributed";
export const COOP_STEP_EVENT = "coop.step";
export const COOP_SANCTIONED_EVENT = "coop.sanctioned";
export const COOP_LEFT_EVENT = "coop.left";
export const COOP_SETTLED_EVENT = "coop.settled";
export const COOP_FAILED_EVENT = "coop.failed";

/** Cuántos adultos invita el líder por día. */
export const COOP_INVITES_PER_DAY = 6;
/** Fracción de la despensa del hogar que promete (repartida entre sus adultos). */
export const COOP_PLEDGE_SHARE = 0.04;
/** Cuánto del total prometido cuesta la obra (si todos pagan sobra; si hay free riders, falta). */
export const COOP_COST_SHARE = 0.6;
/** Días en que se reparte lo prometido. */
export const COOP_CONTRIBUTE_DAYS = 10;
/** Días desde la fundación hasta que se da por perdida. */
export const COOP_DUE_DAYS = 40;
/** Cada cuántos días el líder vigila y los participantes miran si les conviene seguir. */
export const COOP_REVIEW_EVERY = 5;
/** Pasos del plan de un canal. */
export const COOP_CANAL_STEPS: readonly string[] = ["survey", "dig", "line"];

export interface CoopOptions {
  /** Día de mundo desde el cual el cabeza del consejo arma la obra (por defecto 3). */
  readonly startDay?: number;
  /** Unidad del ledger que se junta (por defecto `good:grain`). */
  readonly unit?: string;
  readonly kind?: CoopKind;
  readonly shareRule?: ShareRule;
  /** Vigilancia del líder (0-1). */
  readonly vigilance?: number;
  /** Edad mínima en años para invitar (por defecto 15). */
  readonly adultAge?: number;
}

export interface CoopRow {
  readonly key: string;
  readonly project: Project;
  readonly invited: readonly AgentId[];
  readonly foundedDay: number;
  readonly dueDay: number;
  readonly settled: boolean;
  /** El acuerdo de reparto como `Commitment` (`contracts.commitment`), si el proyecto ya lo tiene. */
  readonly commitment?: string;
}

/** Cada proyecto vive en una entidad `project:n` con este componente. Solo lo escribe `life.coop`. */
export const COOP = table<CoopRow>("life.coop");

export function coopRows(truth: ReadonlyWorldTruth): { id: string; row: CoopRow }[] {
  return [...truth.ids(COOP)]
    .sort()
    .map((id) => ({ id: id as string, row: truth.get(COOP, id) as CoopRow }));
}

/** La cuenta del ledger donde vive el pool del proyecto. */
export const coopAccount = (project: Project): LedgerAccount =>
  holderAccount(project.id as unknown as HolderRef);

export interface CoopProcessOptions extends CoopOptions {
  readonly day: number;
  readonly year: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  readonly traits: readonly Trait[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const unit01 = (x: number): number => Math.min(1, Math.max(0, x));

export function coopProcess(o: CoopProcessOptions): ProcessDef {
  const good: LedgerUnit = ledgerUnit(o.unit ?? "good:grain");
  const startDay = o.startDay ?? 3;
  const adultAge = o.adultAge ?? 15;
  const vigilance = o.vigilance ?? 0.6;
  return {
    id: COOP_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      COOP.name,
      ENTITY.name,
      PERSON.name,
      ORG.name,
      INNATE.name,
      RELATIONS.name,
      COMMITMENTS.name,
    ],
    writes: [COOP.name, ENTITY.name, COMMITMENTS.name],
    run(ctx) {
      const truth = ctx.truth;
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const today = Math.floor(ctx.now / o.day);
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const householdOf = (who: AgentId): LedgerAccount =>
        holderAccount((truth.get(PERSON, who)?.household ?? String(who)) as unknown as HolderRef);
      const adults = [...truth.ids(PERSON)]
        .map((p) => p as AgentId)
        .filter(
          (p) =>
            alive(p) && (ctx.now - (truth.get(PERSON, p)?.born ?? ctx.now)) / o.year >= adultAge,
        )
        .sort();
      const spent = new Map<string, number>();
      const have = (acct: LedgerAccount): number =>
        Math.max(0, Math.floor(ledger.balance(acct, good) ?? 0) - (spent.get(acct) ?? 0));
      const take = (acct: LedgerAccount, n: number): void => {
        spent.set(acct, (spent.get(acct) ?? 0) + n);
      };
      const zOf = (who: AgentId): Record<string, number> => {
        const innate = truth.get(INNATE, who);
        return innate ? standardize(innate, o.traits, truth.get(PERSON, who)?.sex ?? "female") : {};
      };
      const adultsIn = (who: AgentId): number => {
        const h = truth.get(PERSON, who)?.household;
        return Math.max(1, adults.filter((a) => truth.get(PERSON, a)?.household === h).length);
      };
      const pledgeOf = (who: AgentId): number =>
        Math.floor((have(householdOf(who)) * COOP_PLEDGE_SHARE) / adultsIn(who));
      const trustIn = (who: AgentId, other: AgentId): { trust: number; respect: number } => {
        const d = relationship(truth.get(RELATIONS, who), other, ctx.now, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: () => 0,
        }).dims;
        return { trust: unit01(0.5 + 0.5 * (d.trust ?? 0)), respect: unit01(d.respect ?? 0) };
      };

      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const known = new Set<string>();

      const emit = (
        project: Project,
        kind: string,
        actors: AgentId[],
        data: Record<string, unknown>,
        place: AgentId,
        extra: { sight?: number } = {},
      ): EventId => {
        const id = draftEvent(events.length);
        events.push({
          kind,
          actors,
          place: o.placeOf(truth, place),
          data: { project: project.id, ...data },
          emissions: extra.sight ? { sight: extra.sight } : {},
          causes: projectCauses(project).map((event) => ({ kind: "event" as const, event })),
        });
        return id;
      };
      const post = (event: EventId, transfers: Transfer[]): void => {
        if (transfers.length > 0) postings.push({ event, transfers });
      };

      for (const { id, row } of coopRows(truth)) {
        known.add(row.key);
        if (row.settled) continue;
        let project = row.project;
        let invited = row.invited;
        let settled = false;
        const d = today - row.foundedDay;
        const owner = project.owner;
        const acct = coopAccount(project);
        const open = project.status !== "succeeded" && project.status !== "failed";

        // 1. El líder invita de a poco; cada invitado decide sobre lo que cree.
        if (open && alive(owner)) {
          const fresh = adults.filter((a) => a !== owner && !invited.includes(a));
          for (const who of fresh.slice(0, COOP_INVITES_PER_DAY)) {
            invited = [...invited, who];
            const z = zOf(who);
            const t = trustIn(who, owner);
            const view: InviteeView = {
              believedGain: 0.6,
              trustInLeader: t.trust,
              believedRisk: 0.2,
              costOfRefusing: t.respect,
              opportunityCost: 0.25,
              cooperativeness: unit01(0.5 + 0.25 * clampTemper(z["warmth"] ?? 0)),
            };
            const dec = decideJoin(view, ctx.rng.fork("coop_join", id, String(who)));
            const promised = pledgeOf(who);
            if (!dec.join || promised <= 0) continue;
            const told = tellPlan(project, t.trust >= 0.6 ? "all" : 1 + Math.floor(t.trust * 2));
            const ev = emit(
              project,
              COOP_JOINED_EVENT,
              [who, owner],
              { promised, told: told.length, net: dec.net },
              who,
            );
            project = addParticipant(project, {
              agent: who,
              role: "member",
              knownPlan: told,
              believedShare: round6(1 / Math.max(2, adults.length)),
              promised,
              stake: 0,
              joinedBy: ev,
            });
          }
        }

        // 2. Aportes del hogar al pool (ledger: del hogar a la cuenta del proyecto).
        if (open) {
          const others = freeRiderFraction(project);
          for (const part of project.participants) {
            if (part.left || part.forfeited || part.contributed >= part.promised) continue;
            if (!alive(part.agent)) continue;
            const z = zOf(part.agent);
            const view: ContributorView = {
              cooperativeness: unit01(0.5 + 0.25 * clampTemper(z["warmth"] ?? 0)),
              opportunityCost: 0.3,
              believedOthersPay: 1 - others,
              believedOversight: unit01(vigilance),
            };
            const frac = contributionFraction(
              view,
              ctx.rng.fork("coop_pay", id, String(d), String(part.agent)),
            );
            const want = Math.min(
              part.promised - part.contributed,
              Math.max(0, Math.round((part.promised / COOP_CONTRIBUTE_DAYS) * frac)),
            );
            const from = householdOf(part.agent);
            const ev = draftEvent(events.length);
            const r = contribute(project, part.agent, want, have(from), ev);
            if (r.moved === 0) continue;
            emit(project, COOP_CONTRIBUTED_EVENT, [part.agent], { amount: r.moved }, part.agent);
            take(from, r.moved);
            post(ev, [{ unit: good, from, to: acct, amount: r.moved }]);
            project = r.project;
          }
        }

        // 3. Los pasos que el pool alcanza a pagar, hacia el lugar de la obra.
        while (open) {
          const ev = draftEvent(events.length);
          const adv = advanceStep(project, ev);
          if (!adv.step) break;
          emit(
            project,
            COOP_STEP_EVENT,
            [owner],
            { step: adv.step.key, cost: adv.step.cost },
            owner,
          );
          post(ev, [
            {
              unit: good,
              from: acct,
              to: holderAccount(o.placeOf(truth, owner)),
              amount: adv.step.cost,
            },
          ]);
          project = adv.project;
        }

        // 4. Revisión: el líder vigila a los free riders; los que ven injusto el reparto se van.
        if (open && project.status !== "succeeded" && d > 0 && d % COOP_REVIEW_EVERY === 0) {
          if (alive(owner)) {
            for (const x of detectFreeRiders(
              project,
              vigilance,
              ctx.rng.fork("coop_watch", id, String(d)),
            )) {
              const ev = draftEvent(events.length);
              emit(
                project,
                COOP_SANCTIONED_EVENT,
                [owner, x.agent],
                { owed: x.promised - x.contributed },
                x.agent,
              );
              project = sanctionFreeRider(project, x.agent, ev);
            }
          }
          const riders = freeRiderFraction(project);
          for (const x of project.participants) {
            if (x.left || x.forfeited || x.agent === owner || !alive(x.agent)) continue;
            const pressure = leavePressure(
              {
                believedShare: x.believedShare,
                perceivedFreeRiders: riders,
                trustInLeader: trustIn(x.agent, owner).trust,
                sunk: x.promised === 0 ? 0 : unit01(x.contributed / x.promised),
              },
              actualShare(project, x.agent),
            );
            if (pressure < LEAVE_THRESHOLD) continue;
            const ev = draftEvent(events.length);
            emit(project, COOP_LEFT_EVENT, [x.agent, owner], { pressure }, x.agent);
            project = leaveProject(project, x.agent, ev);
          }
        }

        // 5. Cierre: éxito reparte el saldo por la regla; vencido sin éxito reintegra por aporte.
        if (project.status === "succeeded" || today > row.dueDay) {
          const ev = draftEvent(events.length);
          const before = project;
          const ok = project.status === "succeeded";
          let payouts: readonly { agent: AgentId; weight: number }[];
          if (ok) {
            const r = settleProject(project, ev);
            project = r.project;
            payouts = r.payouts;
          } else {
            const weights = project.participants
              .filter((x) => !x.left && !x.forfeited)
              .map((x) => ({ agent: x.agent, weight: x.contributed }));
            const r = distributePool(project.pool, weights, ev);
            project = endProject({ ...project, pool: r.pool }, "failed", ev);
            payouts = r.payouts;
          }
          const paid = payouts.filter((p) => p.weight > 0);
          emit(
            before,
            ok ? COOP_SETTLED_EVENT : COOP_FAILED_EVENT,
            [owner],
            {
              paid: paid.reduce((a, p) => a + p.weight, 0),
              steps: project.plan.length,
              failures: coordinationFailures(project).length,
            },
            owner,
            { sight: 0.2 },
          );
          post(
            ev,
            paid.map((p) => ({
              unit: good,
              from: acct,
              to: householdOf(p.agent),
              amount: p.weight,
            })),
          );
          settled = true;
        }

        if (project !== row.project || invited !== row.invited || settled) {
          changes.push(setComponent(COOP, id as never, { ...row, project, invited, settled }));
          // El reparto como compromiso: se reescribe cuando cambian los participantes o lo aportado.
          if (row.commitment)
            changes.push(
              setComponent(
                COMMITMENTS,
                row.commitment as never,
                shareCommitment(project, {
                  id: row.commitment,
                  startDay: row.foundedDay,
                  dueDay: row.dueDay,
                  day: today,
                }),
              ),
            );
        }
      }

      // Fundación: el cabeza vivo del consejo arma la obra una vez, cuando llega el día.
      const key = "village-canal";
      if (!known.has(key) && today >= startDay) {
        for (const org of [...truth.ids(ORG)].sort()) {
          const o2 = truth.get(ORG, org);
          const head = o2?.positions.find((p) => p.id === HEAD_POSITION)?.holder;
          if (!o2 || !head || !alive(head)) continue;
          const pledges = adults.map((a) => pledgeOf(a));
          const total = Math.floor(pledges.reduce((a, b) => a + b, 0) * COOP_COST_SHARE);
          if (total < COOP_CANAL_STEPS.length) break;
          const per = Math.floor(total / COOP_CANAL_STEPS.length);
          const pid = ctx.newId("project");
          const cid = ctx.newId("commitment");
          const ev = draftEvent(events.length);
          let project = makeProject({
            id: pid,
            kind: o.kind ?? "construction",
            owner: head,
            plan: COOP_CANAL_STEPS.map((k, i) => ({
              key: k,
              cost:
                i === COOP_CANAL_STEPS.length - 1
                  ? total - per * (COOP_CANAL_STEPS.length - 1)
                  : per,
            })),
            good: String(good),
            shareRule: o.shareRule ?? "contribution",
            originEventId: ev,
          });
          const promised = pledgeOf(head);
          project = addParticipant(project, {
            agent: head,
            role: "leader",
            knownPlan: tellPlan(project, "all"),
            believedShare: round6(1 / Math.max(2, adults.length)),
            promised,
            stake: 0.5,
            joinedBy: ev,
          });
          events.push({
            kind: COOP_FOUNDED_EVENT,
            actors: [head],
            place: o.placeOf(truth, head),
            data: { project: pid, kind: project.kind, cost: total, steps: project.plan.length },
            emissions: { sight: 0.1 },
            causes: [{ kind: "event", event: o2.originEventId }],
          });
          changes.push(
            setComponent(
              ENTITY,
              pid as never,
              {
                id: pid,
                originEventId: ev,
                createdAt: ctx.now,
              } as never,
            ),
            setComponent(COOP, pid as never, {
              key,
              project,
              invited: [head],
              foundedDay: today,
              dueDay: today + COOP_DUE_DAYS,
              settled: false,
              commitment: cid as string,
            }),
            setComponent(
              ENTITY,
              cid as never,
              { id: cid, originEventId: ev, createdAt: ctx.now } as never,
            ),
            setComponent(
              COMMITMENTS,
              cid as never,
              shareCommitment(project, {
                id: cid as string,
                startDay: today,
                dueDay: today + COOP_DUE_DAYS,
                day: today,
              }),
            ),
          );
          break;
        }
      }

      return changes.length === 0 && events.length === 0
        ? {}
        : { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}
