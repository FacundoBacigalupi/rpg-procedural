// Crédito: interés en especie (economy §8). Parte pura y opt-in. El principal se devuelve en su
// unidad (plata) y el interés en otra (grano) a una razón fija pactada: `ceil(interés * ratio)`.
// Dos unidades, dos asientos por pago; cada unidad conserva por separado. Un préstamo sin
// `inKind` no pasa por acá (sigue en `credit.ts`, sin cambios de forma ni de hash).

import type { LedgerUnit, Transfer } from "../../core/index.ts";
import { interestOf, type LoanCommitment } from "./credit.ts";

/** Marca el préstamo con interés en especie: unidad y razón (unidades de interés por unidad de interés nominal). */
export function withKindInterest(
  l: LoanCommitment,
  unit: LedgerUnit,
  ratio: number,
): LoanCommitment {
  if (!(ratio > 0) || unit === l.unit) return l;
  return { ...l, inKind: { unit, ratio, paidKind: 0 } };
}

/** Interés total a pagar en la unidad en especie (0 si el préstamo no lo tiene). */
export function kindInterestDue(l: LoanCommitment): number {
  return l.inKind ? Math.ceil(interestOf(l) * l.inKind.ratio) : 0;
}

/** Principal que falta (en `unit`) de un préstamo con interés en especie. */
export function principalOutstanding(l: LoanCommitment): number {
  return Math.max(0, l.principal - l.paid);
}

/** Interés en especie que falta. */
export function kindInterestOutstanding(l: LoanCommitment): number {
  return l.inKind ? Math.max(0, kindInterestDue(l) - l.inKind.paidKind) : 0;
}

export interface KindPayment {
  readonly loan: LoanCommitment;
  readonly paidPrincipal: number;
  readonly paidInterest: number;
  readonly transfers: readonly Transfer[];
}

/**
 * Un pago con dos unidades: el deudor ofrece principal (en plata) e interés (en grano) y paga solo
 * lo que tiene y lo que debe en cada una. Saldado cuando no queda ninguna de las dos.
 */
export function payLoanInKind(
  l: LoanCommitment,
  offeredPrincipal: number,
  offeredInterest: number,
  holdsPrincipal: number,
  holdsInterest: number,
): KindPayment {
  const none: KindPayment = { loan: l, paidPrincipal: 0, paidInterest: 0, transfers: [] };
  if (l.status !== "active" || !l.inKind) return none;
  const p = Math.max(
    0,
    Math.min(Math.floor(offeredPrincipal), Math.floor(holdsPrincipal), principalOutstanding(l)),
  );
  const i = Math.max(
    0,
    Math.min(Math.floor(offeredInterest), Math.floor(holdsInterest), kindInterestOutstanding(l)),
  );
  if (p <= 0 && i <= 0) return none;
  const next: LoanCommitment = {
    ...l,
    paid: l.paid + p,
    inKind: { ...l.inKind, paidKind: l.inKind.paidKind + i },
  };
  const done = principalOutstanding(next) === 0 && kindInterestOutstanding(next) === 0;
  const transfers: Transfer[] = [];
  if (p > 0)
    transfers.push({ unit: l.unit, from: l.borrowerAccount, to: l.lenderAccount, amount: p });
  if (i > 0) {
    transfers.push({
      unit: l.inKind.unit,
      from: l.borrowerAccount,
      to: l.lenderAccount,
      amount: i,
    });
  }
  return {
    loan: done ? { ...next, status: "repaid" } : next,
    paidPrincipal: p,
    paidInterest: i,
    transfers,
  };
}
