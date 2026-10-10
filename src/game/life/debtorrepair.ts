// Reparación de la fama del deudor (credit §6, information §4): cuando quien tenía fama de moroso o
// estafador (rumores `default`/`fraud` con `by` = él, en `RUMORS`) salda del todo su deuda
// (`credit.paid` con `status: "repaid"`), quienes se enteran del pago (el acreedor y algunos
// vecinos del lugar) le rebajan la confianza a esos rumores; nunca los borran de golpe ni
// reparan lo que no oyeron. El evento `credit.reputation_repaired` tiene como causa el pago.
// Opt-in (`LifeParts.debtorRepair`); apagado no existe ni corre. Constantes sin calibrar.

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  ENTITY,
  type EventDraft,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  RUMORS,
  type Rumors,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const DEBTOR_REPAIR_PROCESS = "life.debtor_repair";
export const LOAN_PAID_EVENT = "credit.paid";

/** Fracción de confianza que se conserva en el rumor tras enterarse del pago: el acreedor / un vecino (sin calibrar). */
export const REPAIR_LENDER_KEEPS = 0.2;
export const REPAIR_NEIGHBOR_KEEPS = 0.6;
/** Chance de que cada vecino del lugar se entere del pago (sin calibrar). */
export const REPAIR_NEIGHBOR_CHANCE = 0.4;
/** Bajo esta confianza el rumor se descarta. */
export const REPAIR_DROP_BELOW = 0.05;

const isStain = (h: { content: { by: AgentId | null; kind: string } }, debtor: AgentId) =>
  h.content.by === debtor && (h.content.kind === "default" || h.content.kind === "fraud");

/** Cuántos rumores de morosidad o estafa sobre `debtor` guarda `rumors`. */
export function debtorStains(rumors: Rumors | undefined, debtor: AgentId): number {
  return (rumors?.items ?? []).filter((h) => isStain(h, debtor)).length;
}

/**
 * Pura: deja en `keeps` (0-1) de su confianza los rumores `default`/`fraud` sobre `debtor`.
 * Devuelve el mismo objeto si no había nada que reparar.
 */
export function repairDebtorRumors(
  rumors: Rumors | undefined,
  debtor: AgentId,
  keeps: number,
): Rumors | undefined {
  if (!rumors || debtorStains(rumors, debtor) === 0) return rumors;
  const k = Math.min(1, Math.max(0, keeps));
  const items = rumors.items.flatMap((h) => {
    if (!isStain(h, debtor)) return [h];
    const confidence = h.confidence * k;
    return confidence < REPAIR_DROP_BELOW ? [] : [{ ...h, confidence }];
  });
  return { items, told: rumors.told };
}

export const SCAM_REFUNDED_EVENT = "scam.refunded";
export const USURY_RULED_EVENT = "credit.usury_ruled";
export const CORRECTION_SPREAD_EVENT = "credit.correction_spread";

/** Restitución: la víctima, los vecinos y el boca a boca (segundo salto, de cualquier lugar) conservan (sin calibrar). */
export const RESTITUTION_VICTIM_KEEPS = 0.3;
export const RESTITUTION_NEIGHBOR_KEEPS = 0.65;
export const RESTITUTION_SPREAD_KEEPS = 0.85;
export const RESTITUTION_SPREAD_CHANCE = 0.15;

/**
 * Pura: si el evento es una restitución de lo mal habido, devuelve quién restituye y a quién
 * (estafa devuelta con `paid.amount > 0`; fallo de usura que procede con `refund + fine > 0`).
 */
export function restitutionOf(e: {
  kind: string;
  actors: readonly (AgentId | undefined)[];
  data: unknown;
}): { culprit: AgentId; victim: AgentId } | null {
  const [first, second] = e.actors;
  if (!first || !second) return null;
  const d = e.data as {
    paid?: { amount?: number };
    upheld?: boolean;
    refund?: number;
    fine?: number;
  };
  if (e.kind === SCAM_REFUNDED_EVENT)
    return (d.paid?.amount ?? 0) > 0 ? { culprit: first, victim: second } : null;
  if (e.kind === USURY_RULED_EVENT)
    return d.upheld === true && (d.refund ?? 0) + (d.fine ?? 0) > 0
      ? { culprit: second, victim: first }
      : null;
  return null;
}

export interface DebtorRepairOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Opt-in: también repara la fama de quien devuelve lo mal habido (estafa o usura) y corre la voz. */
  readonly restitution?: boolean;
}

export function debtorRepairProcess(o: DebtorRepairOptions): ProcessDef {
  return {
    id: DEBTOR_REPAIR_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [RUMORS.name, ENTITY.name, PERSON.name],
    writes: [RUMORS.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const next = new Map<AgentId, Rumors>();
      for (const e of ctx.recent) {
        const rest = o.restitution ? restitutionOf(e as never) : null;
        if (rest) {
          const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
          const here = JSON.stringify(o.placeOf(truth, rest.culprit));
          const keeps = new Map<AgentId, number>();
          if (alive(rest.victim)) keeps.set(rest.victim, RESTITUTION_VICTIM_KEEPS);
          for (const id of (truth.ids(PERSON) as AgentId[]).sort()) {
            if (id === rest.culprit || keeps.has(id) || !alive(id)) continue;
            const near = JSON.stringify(o.placeOf(truth, id)) === here;
            const fork = ctx.rng.fork("restitution_repair", e.id, id);
            if (near) {
              if (!fork.chance(REPAIR_NEIGHBOR_CHANCE)) continue;
              keeps.set(id, RESTITUTION_NEIGHBOR_KEEPS);
            } else if (fork.chance(RESTITUTION_SPREAD_CHANCE)) {
              keeps.set(id, RESTITUTION_SPREAD_KEEPS);
            }
          }
          let repaired = 0;
          let spread = 0;
          for (const [who, k] of keeps) {
            const before = next.get(who) ?? truth.get(RUMORS, who);
            if (debtorStains(before, rest.culprit) === 0) continue;
            const after = repairDebtorRumors(before, rest.culprit, k);
            if (!after) continue;
            next.set(who, after);
            if (k === RESTITUTION_SPREAD_KEEPS) spread++;
            else repaired++;
          }
          const cause = [{ kind: "event" as const, event: e.id }];
          if (repaired > 0)
            events.push({
              kind: "credit.reputation_repaired",
              actors: [rest.culprit, rest.victim],
              place: o.placeOf(truth, rest.culprit),
              data: { restitution: e.kind, holders: repaired },
              emissions: {},
              causes: cause,
            });
          if (spread > 0)
            events.push({
              kind: CORRECTION_SPREAD_EVENT,
              actors: [rest.culprit, rest.victim],
              place: o.placeOf(truth, rest.culprit),
              data: { restitution: e.kind, holders: spread },
              emissions: {},
              causes: cause,
            });
          continue;
        }
        if (e.kind !== LOAN_PAID_EVENT) continue;
        if ((e.data as { status?: string }).status !== "repaid") continue;
        const [debtor, lender] = e.actors as (AgentId | undefined)[];
        if (!debtor || !lender) continue;
        const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
        const here = JSON.stringify(o.placeOf(truth, debtor));
        const keeps = new Map<AgentId, number>();
        if (alive(lender)) keeps.set(lender, REPAIR_LENDER_KEEPS);
        for (const id of (truth.ids(PERSON) as AgentId[]).sort()) {
          if (id === debtor || keeps.has(id) || !alive(id)) continue;
          if (JSON.stringify(o.placeOf(truth, id)) !== here) continue;
          if (!ctx.rng.fork("debtor_repair", e.id, id).chance(REPAIR_NEIGHBOR_CHANCE)) continue;
          keeps.set(id, REPAIR_NEIGHBOR_KEEPS);
        }
        let repaired = 0;
        for (const [who, k] of keeps) {
          const before = next.get(who) ?? truth.get(RUMORS, who);
          if (debtorStains(before, debtor) === 0) continue;
          const after = repairDebtorRumors(before, debtor, k);
          if (after) {
            next.set(who, after);
            repaired++;
          }
        }
        if (repaired > 0)
          events.push({
            kind: "credit.reputation_repaired",
            actors: [debtor, lender],
            place: o.placeOf(truth, debtor),
            data: { loan: (e.data as { loan?: string }).loan, holders: repaired },
            emissions: {},
            causes: [{ kind: "event", event: e.id }],
          });
      }
      for (const [who, r] of [...next].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        changes.push(setComponent(RUMORS, who, r));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
