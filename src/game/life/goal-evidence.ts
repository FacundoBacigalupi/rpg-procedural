// Evidencia de progreso propio para cerrar metas concretas (npc-psychology §7, f3d4c). La única meta
// con final hoy es saldar una deuda (`medium:debt:<acreedor>`): cuenta como cumplida cuando el
// libro propio de deuda la da por saldada y el deudor recuerda cada pago que lo sostiene. Los pagos
// que no recuerda no cuentan: sin memoria no hay momento ni evento propio que citar.

import type { Duration, Tick } from "../../core/index.ts";
import type { Goal, GoalProgressEvidence, Memories } from "../../sim/index.ts";
import type { DebtBook } from "./debtknowledge.ts";
import type { DecideOptions } from "./decide.ts";

export const DEBT_GOAL_PREFIX = "medium:debt:";
/** Cada pago recordado aporta un tercio: hacen falta varios. */
export const DEBT_PAYMENT_PROGRESS = 0.34;

export function debtGoalEvidence(
  goal: Goal,
  memories: Memories | undefined,
  debts: DebtBook | undefined,
): GoalProgressEvidence[] {
  if (!goal.id.startsWith(DEBT_GOAL_PREFIX) || goal.target === undefined) return [];
  const known = new Map((memories?.items ?? []).map((m) => [m.eventId as string, m.at]));
  const out: GoalProgressEvidence[] = [];
  for (const b of debts?.items ?? []) {
    if (b.role !== "debtor" || b.other !== goal.target) continue;
    if (b.status !== "fulfilled" && b.status !== "settled") continue;
    for (const source of b.sources) {
      const at = known.get(source);
      if (source === b.originEventId || at === undefined) continue;
      out.push({ goalId: goal.id, cause: source, at: at as Tick, amount: DEBT_PAYMENT_PROGRESS });
    }
  }
  return out;
}

/** El proveedor para `DecideOptions.goalProgress`: solo la deuda saldada es concreta. */
export function debtGoalProgress(minSpan: Duration): NonNullable<DecideOptions["goalProgress"]> {
  return {
    concrete: (goal) => goal.id.startsWith(DEBT_GOAL_PREFIX),
    evidenceOf: debtGoalEvidence,
    minSpan,
  };
}
