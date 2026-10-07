// El fiado de aldea (contracts §1, §3, Implementación Fase 1): el primer compromiso. Un vecino le
// presta a otro de palabra, sin papel ni testigos, y los únicos ejecutores son el acreedor (que
// reclama) y la fama (lo que la aldea sabe de quien no paga). Nada se cumple solo: devolver es un
// `give` del deudor, y este módulo solo lleva la cuenta de lo que quedó debido, con su origen.

import type { AgentId, Duration, EventId, LedgerUnit, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export type CreditStatus = "open" | "defaulted" | "settled";

export interface Credit {
  readonly kind: "credit";
  readonly creditor: AgentId;
  readonly debtor: AgentId;
  /** El bien prestado y el que se devuelve (mismo bien, sin interés: es fiado entre vecinos). */
  readonly unit: LedgerUnit;
  readonly principal: number;
  /** Lo que falta devolver. */
  readonly owed: number;
  readonly lent: Tick;
  readonly due: Tick;
  readonly status: CreditStatus;
  /** Los pagos y el reclamo, en orden (el origen es el `originEventId` de la entidad). */
  readonly history: readonly EventId[];
}

/** El compromiso vive en una entidad `commitment:n` con este componente. */
export const CREDIT = table<Credit>("contracts.credit");

/** Plazo del fiado, en días de mundo. */
export const CREDIT_TERM_DAYS = 30;
/** Cuánto se espera después del plazo antes de dar la deuda por incumplida. */
export const CREDIT_GRACE_DAYS = 7;
/** Hasta cuánto le fía un vecino a una misma persona (gramos): más allá, primero pagá. */
export const CREDIT_LIMIT_GRAMS = 1000;

export function lend(
  creditor: AgentId,
  debtor: AgentId,
  unit: LedgerUnit,
  grams: number,
  at: Tick,
  day: Duration,
): Credit {
  return {
    kind: "credit",
    creditor,
    debtor,
    unit,
    principal: grams,
    owed: grams,
    lent: at,
    due: at + CREDIT_TERM_DAYS * day,
    status: "open",
    history: [],
  };
}

/** Lo que cuenta como deuda viva (todavía se debe algo). */
export function isLive(c: Credit): boolean {
  return c.status !== "settled" && c.owed > 0;
}

/** Vencida y pasada la gracia: es la que el acreedor reclama. */
export function isOverdue(c: Credit, now: Tick, day: Duration): boolean {
  return c.status === "open" && now > c.due + CREDIT_GRACE_DAYS * day;
}

/** Paga hasta `grams` de la deuda; devuelve la deuda nueva y cuánto se aplicó. */
export function repay(
  c: Credit,
  grams: number,
  event: EventId,
): { readonly credit: Credit; readonly applied: number } {
  const applied = Math.max(0, Math.min(c.owed, grams));
  if (applied === 0) return { credit: c, applied };
  const owed = c.owed - applied;
  return {
    credit: {
      ...c,
      owed,
      status: owed <= 0 ? "settled" : c.status,
      history: [...c.history, event],
    },
    applied,
  };
}

/** La deuda incumplida: el acreedor ya la reclamó (el evento del reclamo es `law.default`). */
export function declareDefault(c: Credit): Credit {
  return { ...c, status: "defaulted" };
}

export interface CreditRow {
  readonly id: string;
  readonly credit: Credit;
}

/** Las deudas vivas de `debtor` con `creditor` (o con cualquiera), las más viejas primero. */
export function liveBetween(
  rows: readonly CreditRow[],
  debtor: AgentId,
  creditor?: AgentId,
): CreditRow[] {
  return rows
    .filter(
      (r) =>
        isLive(r.credit) &&
        r.credit.debtor === debtor &&
        (creditor === undefined || r.credit.creditor === creditor),
    )
    .sort((a, b) => a.credit.lent - b.credit.lent || (a.id < b.id ? -1 : 1));
}

/** Cuánto debe `debtor` de `unit` a `creditor`. */
export function owedTo(
  rows: readonly CreditRow[],
  debtor: AgentId,
  creditor: AgentId,
  unit?: LedgerUnit,
): number {
  return liveBetween(rows, debtor, creditor)
    .filter((r) => unit === undefined || r.credit.unit === unit)
    .reduce((sum, r) => sum + r.credit.owed, 0);
}

/** Aplica un pago a las deudas más viejas primero; devuelve las que cambiaron. */
export function applyPayment(
  rows: readonly CreditRow[],
  payer: AgentId,
  to: AgentId,
  unit: LedgerUnit,
  grams: number,
  event: EventId,
): CreditRow[] {
  let left = grams;
  const changed: CreditRow[] = [];
  for (const row of liveBetween(rows, payer, to).filter((r) => r.credit.unit === unit)) {
    if (left <= 0) break;
    const { credit, applied } = repay(row.credit, left, event);
    left -= applied;
    if (applied > 0) changed.push({ id: row.id, credit });
  }
  return changed;
}
