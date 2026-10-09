// Crédito de cosecha y usura con colateral (economy §8, contracts §13). Parte pura: el préstamo es
// la vista económica de un `Commitment` de tipo `loan`; el prestamista fija la tasa desde el riesgo
// que CREE (reputación del deudor, colateral que él valúa, si puede cobrar) y desde el poder de
// negociación (el desesperado acepta cualquier tasa); la cuota entra a `HouseholdFlows.fixedPerDay`;
// la mora ejecuta el colateral por su valor real y después a los fiadores. Todo movimiento sale
// como transferencia del ledger: el interés no se crea, sale de lo que produce el deudor. Sin RNG:
// el azar (si el deudor puede pagar) lo trae el llamador.

import type { CommitmentId, LedgerAccount, LedgerUnit, Transfer } from "../../core/index.ts";
import type { HouseholdFlows } from "./budget.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Tasa por plazo (a cosecha) de un préstamo sin riesgo percibido. */
export const BASE_RATE = 0.05;
/** Cuánto suma a la tasa cada punto de probabilidad creída de impago. */
export const RISK_RATE_WEIGHT = 0.6;
/** Cuánto suma a la tasa el poder de negociación del prestamista completo. */
export const BARGAIN_RATE_WEIGHT = 0.4;
/** Tasa máxima que permite la norma local (`usuryCap` la baja o la sube). */
export const DEFAULT_USURY_CAP = 0.5;
/** Fracción del valor creído del colateral que el prestamista presta como máximo. */
export const LOAN_TO_VALUE = 0.6;
/** Fracción del colateral que se pierde al venderlo a las apuradas (ejecución). */
export const FORCED_SALE_HAIRCUT = 0.2;

export type LoanStatus = "active" | "repaid" | "defaulted" | "settled";

export interface Collateral {
  /** Id del bien, lote o tierra puesto en garantía. */
  readonly ref: string;
  /** Cuánto lo valúa el prestamista (lo que cree). */
  readonly believedValue: number;
  /** Cuánto vale de verdad (verdad oculta: defectos, calidad, título dudoso). */
  readonly trueValue: number;
  /** Cuenta del ledger de quien lo tiene en prenda (el deudor o el prestamista). */
  readonly heldBy: LedgerAccount;
}

export interface Guarantor {
  readonly id: string;
  readonly account: LedgerAccount;
  /** Fracción de la deuda que respalda (0 a 1). */
  readonly share: number;
}

/** El `Commitment` de tipo préstamo (la parte económica; `parties` y `obligations` los arma el contrato). */
export interface LoanCommitment {
  readonly id: CommitmentId;
  readonly kind: "loan";
  readonly lender: string;
  readonly borrower: string;
  readonly lenderAccount: LedgerAccount;
  readonly borrowerAccount: LedgerAccount;
  /** Unidad del principal (moneda o bien: semilla, grano). */
  readonly unit: LedgerUnit;
  readonly principal: number;
  /** Interés simple por plazo (0,2 = 20% del principal al vencer). */
  readonly rate: number;
  readonly startDay: number;
  /** Día de la cosecha en que vence. */
  readonly dueDay: number;
  readonly collateral: readonly Collateral[];
  readonly guarantors: readonly Guarantor[];
  /** Lo ya pagado (cuenta primero al interés). */
  readonly paid: number;
  readonly status: LoanStatus;
  readonly originEventId: string;
}

/** Lo que cree el prestamista del deudor, para estimar el riesgo. */
export interface LenderBeliefs {
  /** Reputación del deudor como pagador (0 a 1). */
  readonly reputation: number;
  /** Cuánto cree que rinde la cosecha del deudor respecto de la deuda (1 = justo alcanza). */
  readonly expectedYieldCover: number;
  /** Cuánto cree que puede cobrar si no paga: ley, clan, temor (0 a 1). */
  readonly enforceability: number;
}

/** Probabilidad creída de impago (0 a 1) con el colateral valuado como el prestamista lo cree. */
export function estimatedDefault(
  b: LenderBeliefs,
  loanValue: number,
  collateralBelieved: number,
): number {
  const cover = loanValue > 0 ? clamp(collateralBelieved / loanValue, 0, 1) : 1;
  const yieldRisk = clamp(1 - (b.expectedYieldCover - 0.5), 0, 1) * 0.5;
  const reputationRisk = (1 - clamp(b.reputation, 0, 1)) * 0.5;
  const raw =
    (yieldRisk + reputationRisk) * (1 - 0.6 * cover) * (1 - 0.5 * clamp(b.enforceability, 0, 1));
  return clamp(raw, 0, 1);
}

/** Poder de negociación del prestamista (0 a 1): sube con la desesperación del deudor y baja con la competencia. */
export function bargainingPower(borrowerDesperation: number, rivalLenders: number): number {
  const need = clamp(borrowerDesperation, 0, 1);
  return clamp(need / (1 + Math.max(0, rivalLenders)), 0, 1);
}

/**
 * Tasa por plazo: base (más cara con el dinero escaso) + riesgo creído + poder de negociación,
 * con el tope de la norma (usura). `scarcity` va de 0 a 1.
 */
export function loanRate(
  defaultProb: number,
  bargaining: number,
  scarcity: number,
  usuryCap: number = DEFAULT_USURY_CAP,
): number {
  const r =
    BASE_RATE * (1 + clamp(scarcity, 0, 1)) +
    RISK_RATE_WEIGHT * clamp(defaultProb, 0, 1) +
    BARGAIN_RATE_WEIGHT * clamp(bargaining, 0, 1) * 0.5;
  return Math.min(Math.max(0, usuryCap), r);
}

/** Tope de principal que el prestamista da con ese colateral (valuación creída) más lo que presta sin garantía. */
export function maxPrincipal(collaterals: readonly Collateral[], unsecuredLimit: number): number {
  let v = 0;
  for (const c of collaterals) v += c.believedValue;
  return Math.floor(LOAN_TO_VALUE * v + Math.max(0, unsecuredLimit));
}

/** Valor real del colateral: lo que se cobra de verdad al ejecutarlo, con el descuento de venta forzada. */
export function collateralRealValue(collaterals: readonly Collateral[]): number {
  let v = 0;
  for (const c of collaterals) v += Math.floor(c.trueValue * (1 - FORCED_SALE_HAIRCUT));
  return v;
}

/** Total a devolver al vencer: principal más interés simple. */
export function totalDue(l: Pick<LoanCommitment, "principal" | "rate">): number {
  return l.principal + Math.round(l.principal * l.rate);
}

/** Interés del préstamo (sale de lo que produce el deudor, no se crea). */
export function interestOf(l: Pick<LoanCommitment, "principal" | "rate">): number {
  return totalDue(l) - l.principal;
}

/** Lo que falta pagar. */
export function outstanding(l: LoanCommitment): number {
  return Math.max(0, totalDue(l) - l.paid);
}

export interface LoanInput {
  readonly id: CommitmentId;
  readonly lender: string;
  readonly borrower: string;
  readonly lenderAccount: LedgerAccount;
  readonly borrowerAccount: LedgerAccount;
  readonly unit: LedgerUnit;
  readonly requested: number;
  readonly rate: number;
  readonly startDay: number;
  readonly dueDay: number;
  readonly collateral: readonly Collateral[];
  readonly guarantors: readonly Guarantor[];
  readonly unsecuredLimit: number;
  readonly originEventId: string;
}

/** Arma el préstamo; el principal se recorta al tope que dan el colateral y lo no asegurado. */
export function makeLoan(input: LoanInput): LoanCommitment | undefined {
  const principal = Math.min(
    Math.floor(input.requested),
    maxPrincipal(input.collateral, input.unsecuredLimit),
  );
  if (principal <= 0 || input.dueDay <= input.startDay) return undefined;
  return {
    id: input.id,
    kind: "loan",
    lender: input.lender,
    borrower: input.borrower,
    lenderAccount: input.lenderAccount,
    borrowerAccount: input.borrowerAccount,
    unit: input.unit,
    principal,
    rate: input.rate,
    startDay: input.startDay,
    dueDay: input.dueDay,
    collateral: input.collateral,
    guarantors: input.guarantors,
    paid: 0,
    status: "active",
    originEventId: input.originEventId,
  };
}

/** Desembolso: el prestamista entrega el principal al deudor. */
export function disburseTransfers(l: LoanCommitment): readonly Transfer[] {
  return [{ unit: l.unit, from: l.lenderAccount, to: l.borrowerAccount, amount: l.principal }];
}

/** Cuota diaria fija que el presupuesto cuenta: lo que falta repartido en los días hasta el vencimiento. */
export function installmentPerDay(l: LoanCommitment, today: number): number {
  if (l.status !== "active") return 0;
  const days = Math.max(1, l.dueDay - today);
  return outstanding(l) / days;
}

/** El presupuesto del hogar con la cuota de sus deudas sumada a los gastos fijos. */
export function withLoanPayments(
  h: HouseholdFlows,
  loans: readonly LoanCommitment[],
  today: number,
): HouseholdFlows {
  let add = 0;
  for (const l of loans) add += installmentPerDay(l, today);
  return add > 0 ? { ...h, fixedPerDay: h.fixedPerDay + add } : h;
}

/**
 * Un pago del deudor: solo paga lo que tiene y lo que debe. Devuelve el préstamo actualizado
 * (saldado si cubrió todo) y la transferencia del deudor al prestamista.
 */
export function payLoan(
  l: LoanCommitment,
  offered: number,
  borrowerHolds: number,
): {
  readonly loan: LoanCommitment;
  readonly paid: number;
  readonly transfers: readonly Transfer[];
} {
  if (l.status !== "active") return { loan: l, paid: 0, transfers: [] };
  const pay = Math.max(0, Math.min(Math.floor(offered), Math.floor(borrowerHolds), outstanding(l)));
  if (pay <= 0) return { loan: l, paid: 0, transfers: [] };
  const next: LoanCommitment = { ...l, paid: l.paid + pay };
  const loan: LoanCommitment = outstanding(next) === 0 ? { ...next, status: "repaid" } : next;
  return {
    loan,
    paid: pay,
    transfers: [{ unit: l.unit, from: l.borrowerAccount, to: l.lenderAccount, amount: pay }],
  };
}

export interface CollateralSeizure {
  readonly ref: string;
  readonly from: LedgerAccount;
  readonly to: LedgerAccount;
}

export interface DefaultResult {
  readonly loan: LoanCommitment;
  /** Colateral que pasa al prestamista (traspaso de tenencia, no de monedas). */
  readonly seized: readonly CollateralSeizure[];
  /** Prendas que no hicieron falta y siguen con el deudor. */
  readonly released: readonly string[];
  /** Pagos de fiadores al prestamista por lo que el colateral no cubrió. */
  readonly transfers: readonly Transfer[];
  /** Deuda que quedó sin cobrar (pérdida del prestamista; nada se inventa para cubrirla). */
  readonly loss: number;
  /** Fiadores que pagaron (quedan como acreedores del deudor, contracts §5). */
  readonly guarantorsPaid: readonly { readonly id: string; readonly amount: number }[];
}

/**
 * Mora al vencer: se ejecuta el colateral por su valor REAL (con descuento de venta forzada), en
 * el orden dado, hasta cubrir lo que falta; lo que no hace falta se libera. Si no alcanza,
 * responden los fiadores con lo que tengan (`holds` por id) según su `share`; el resto es pérdida.
 */
export function executeDefault(
  l: LoanCommitment,
  today: number,
  holds: ReadonlyMap<string, number>,
): DefaultResult {
  const owed = outstanding(l);
  if (l.status !== "active" || today < l.dueDay || owed <= 0) {
    return { loan: l, seized: [], released: [], transfers: [], loss: 0, guarantorsPaid: [] };
  }
  const seized: CollateralSeizure[] = [];
  const released: string[] = [];
  let covered = 0;
  for (const c of l.collateral) {
    if (covered >= owed) {
      released.push(c.ref);
      continue;
    }
    seized.push({ ref: c.ref, from: c.heldBy, to: l.lenderAccount });
    covered += Math.floor(c.trueValue * (1 - FORCED_SALE_HAIRCUT));
  }
  let rest = Math.max(0, owed - covered);
  const transfers: Transfer[] = [];
  const guarantorsPaid: { id: string; amount: number }[] = [];
  if (rest > 0) {
    const base = rest;
    for (const g of l.guarantors) {
      const want = Math.min(rest, Math.ceil(base * clamp(g.share, 0, 1)));
      const give = Math.max(0, Math.min(want, Math.floor(holds.get(g.id) ?? 0)));
      if (give <= 0) continue;
      transfers.push({ unit: l.unit, from: g.account, to: l.lenderAccount, amount: give });
      guarantorsPaid.push({ id: g.id, amount: give });
      rest -= give;
    }
  }
  const loan: LoanCommitment = {
    ...l,
    paid: l.paid + (owed - rest),
    status: rest > 0 ? "defaulted" : "settled",
  };
  return { loan, seized, released, transfers, loss: rest, guarantorsPaid };
}
