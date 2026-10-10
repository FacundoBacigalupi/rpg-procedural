// Servidumbre por deudas (contracts §2, §13; social-structure §7), parte pura: un `Commitment`
// de trabajo que nace de una deuda impaga. El deudor sirve al acreedor y cada día trabajado
// abona `creditPerDay` de la deuda, neto del sustento que el acreedor le cobra (por eso "casi
// nunca llega" si el sustento se come el abono). Tiene duración (`term`), y termina por pago,
// por cumplirse el plazo, por rescate (un tercero paga lo que falta), por fuga (ruptura del
// deudor) o por abuso (el acreedor rompe el trato). Todo puro, sin RNG ni reloj.

import type { Commitment, EnforcerRef } from "./commitment.ts";

export const WORK_DAY_UNIT = "work-day";

export type BondageEnd = "paid" | "term" | "ransom" | "escape" | "abuse";

export interface BondageInput {
  readonly id: string;
  readonly creditor: string;
  readonly debtor: string;
  /** La deuda impaga que se salda trabajando, en la unidad de cuenta del abono. */
  readonly debt: number;
  /** Lo que vale un día de trabajo del deudor para el acreedor. */
  readonly wagePerDay: number;
  /** Sustento diario que el acreedor descuenta (casa, comida). */
  readonly upkeepPerDay: number;
  readonly startDay: number;
  /** Duración máxima en días; al cumplirse, la deuda restante se condona o se discute. */
  readonly maxDays: number;
  /** `imposed` si lo impuso la fuerza o un tribunal; `agreement`/`norm` si la cultura lo reconoce. */
  readonly basis?: "agreement" | "norm" | "imposed";
  readonly enforcers?: readonly EnforcerRef[];
  /** Compromiso de préstamo del que nace (la deuda impaga). */
  readonly parent?: string;
  readonly originEventId: string;
}

/** Abono neto por día: nunca negativo. Con 0 la deuda no baja nunca (servidumbre perpetua). */
export const netCreditPerDay = (wagePerDay: number, upkeepPerDay: number): number =>
  Math.max(0, wagePerDay - upkeepPerDay);

/** Días de trabajo que faltan para saldar `debt` al abono dado; `Infinity` si no baja. */
export function daysToPay(debt: number, creditPerDay: number): number {
  if (debt <= 0) return 0;
  return creditPerDay > 0 ? Math.ceil(debt / creditPerDay) : Number.POSITIVE_INFINITY;
}

/**
 * El compromiso de servidumbre. `duty.qty` son los días que faltan (acotados por `maxDays` si el
 * abono es 0, así la obligación sigue siendo finita y serializable).
 */
export function makeBondage(i: BondageInput): Commitment | undefined {
  if (i.debt <= 0 || i.maxDays <= 0) return undefined;
  const credit = netCreditPerDay(i.wagePerDay, i.upkeepPerDay);
  const days = Math.min(daysToPay(i.debt, credit), i.maxDays);
  const enforcers: EnforcerRef[] = [
    { kind: "counterparty", reads: "belief" },
    ...(i.enforcers ?? []),
  ];
  return {
    id: i.id,
    kind: "bondage",
    basis: i.basis ?? "norm",
    parties: [
      { ref: i.creditor, role: "master" },
      { ref: i.debtor, role: "bonded" },
    ],
    obligations: [
      {
        id: `${i.id}#work`,
        debtor: i.debtor,
        creditor: i.creditor,
        duty: { kind: "work", unit: WORK_DAY_UNIT, qty: days, creditPerDay: credit },
        dueDay: i.startDay + i.maxDays,
        state: "pending",
        performed: 0,
      },
    ],
    guarantees: [],
    enforcers,
    status: "active",
    term: { startDay: i.startDay, endDay: i.startDay + i.maxDays },
    ...(i.parent !== undefined ? { parent: i.parent } : {}),
    originEventId: i.originEventId,
    history: [],
  };
}

/** Días de trabajo que faltan. */
export function bondageDaysLeft(c: Commitment): number {
  const o = c.obligations[0];
  return o ? Math.max(0, o.duty.qty - o.performed) : 0;
}

/** Deuda que queda en la unidad de cuenta (días que faltan por abono). */
export function bondageDebtLeft(c: Commitment): number {
  const o = c.obligations[0];
  if (!o || o.duty.kind !== "work") return 0;
  return bondageDaysLeft(c) * o.duty.creditPerDay;
}

export interface WorkDayResult {
  readonly commitment: Commitment;
  /** Lo abonado de la deuda este día. */
  readonly credited: number;
  /** Se saldó (todos los días cumplidos). */
  readonly paid: boolean;
}

/**
 * Un día de trabajo (`fraction` en 0..1 si trabajó menos, por enfermedad o herida). Solo corre
 * mientras el compromiso está activo y no venció el plazo.
 */
export function workBondageDay(c: Commitment, day: number, fraction = 1): WorkDayResult {
  const o = c.obligations[0];
  if (!o || o.duty.kind !== "work" || c.status !== "active" || day >= c.term.endDay)
    return { commitment: c, credited: 0, paid: false };
  const f = Math.min(1, Math.max(0, fraction));
  const performed = Math.min(o.duty.qty, o.performed + f);
  const paid = performed >= o.duty.qty;
  const next: Commitment = {
    ...c,
    obligations: [{ ...o, performed, state: paid ? "fulfilled" : "partial" }],
    status: paid ? "fulfilled" : "active",
  };
  return { commitment: next, credited: (performed - o.performed) * o.duty.creditPerDay, paid };
}

/**
 * Termina la servidumbre antes de pagarse (o la cierra al cumplirse el plazo):
 * - `term`: venció el plazo con deuda pendiente; se da por saldada (`settled`), lo que falta se pierde.
 * - `ransom`: un tercero pagó lo que falta (`settled`; quien rescata queda como acreedor aparte).
 * - `escape`: el deudor huyó, ruptura suya (`defaulted`, queda deuda y mala fama).
 * - `abuse`: el acreedor rompió el trato (`settled`, el deudor queda libre; el acreedor es el infractor).
 * `paid` marca `fulfilled`. Devuelve la deuda que quedó sin cobrar.
 */
export function endBondage(
  c: Commitment,
  end: BondageEnd,
  eventId: string,
): { readonly commitment: Commitment; readonly unpaid: number } {
  const unpaid = bondageDebtLeft(c);
  const o = c.obligations[0];
  const status = end === "paid" ? "fulfilled" : end === "escape" ? "defaulted" : "settled";
  const state =
    end === "paid" ? "fulfilled" : end === "escape" ? "defaulted" : (o?.state ?? "partial");
  return {
    commitment: {
      ...c,
      status,
      obligations: o ? [{ ...o, state }] : c.obligations,
      history: [...c.history, eventId],
    },
    unpaid: end === "paid" ? 0 : unpaid,
  };
}

/** ¿Vence el plazo hoy sin estar saldada? */
export const bondageExpired = (c: Commitment, day: number): boolean =>
  c.status === "active" && day >= c.term.endDay;
