// Economía funeraria pura (spirits §11). El llamador elige el rito desde creencias/costumbres,
// aporta existencias reales y asienta las transferencias con el evento causal de la muerte.
import type { LedgerAccount, LedgerUnit, Transfer } from "../../core/index.ts";
import { disburseTransfers, type LoanCommitment, type LoanInput, makeLoan } from "./credit.ts";

export interface FuneralMaterial {
  readonly unit: LedgerUnit;
  readonly amount: number;
  /** Tumba para el ajuar; ceniza, comensales o artesano para otros bienes. */
  readonly destination: LedgerAccount;
}

export interface FuneralInput {
  readonly household: LedgerAccount;
  readonly stocks: ReadonlyMap<LedgerUnit, number>;
  readonly materials: readonly FuneralMaterial[];
  readonly copper: LedgerUnit;
  readonly fee: number;
  readonly provider: LedgerAccount;
  /** Condiciones del crédito existente. No se inventa prestamista ni liquidez. */
  readonly credit?: {
    readonly terms: Omit<LoanInput, "requested" | "unit" | "borrowerAccount">;
    readonly lenderCopper: number;
  };
  /** Peso social de un funeral pobre, desde la costumbre creída (0..1). */
  readonly faceWeight: number;
}

export interface FuneralResult {
  readonly transfers: readonly Transfer[];
  readonly loan?: LoanCommitment;
  readonly paid: number;
  readonly unpaid: number;
  readonly materialsComplete: boolean;
  readonly dignified: boolean;
  /** Déficit material o de pago; propuesta de pérdida de cara, no lectura omnisciente. */
  readonly faceLoss: number;
}

function quantity(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Resuelve el gasto sin escribir estado. Los bienes salen de las reservas una sola vez incluso
 * si varias líneas usan la misma unidad. El crédito financia solo el servicio de un rito con
 * materiales completos y nunca supera las monedas del prestamista ni el límite de `makeLoan`.
 * El ajuar se transfiere a la cuenta de la tumba y sigue existiendo; no se consume ni se vende.
 */
export function funeralExpense(input: FuneralInput): FuneralResult {
  const remaining = new Map(input.stocks);
  const transfers: Transfer[] = [];
  let materialsComplete = true;
  let materialFulfillment = 1;
  for (const material of input.materials) {
    const wanted = quantity(material.amount);
    if (wanted === 0) continue;
    const available = quantity(remaining.get(material.unit) ?? 0);
    const given = Math.min(wanted, available);
    remaining.set(material.unit, available - given);
    materialFulfillment = Math.min(materialFulfillment, given / wanted);
    if (given < wanted) materialsComplete = false;
    if (given > 0) {
      transfers.push({
        unit: material.unit,
        from: input.household,
        to: material.destination,
        amount: given,
      });
    }
  }
  const fee = quantity(input.fee);
  const cash = quantity(remaining.get(input.copper) ?? 0);
  const shortage = Math.max(0, fee - cash);
  let loan: LoanCommitment | undefined;
  const credit = input.credit;
  if (
    materialsComplete &&
    shortage > 0 &&
    credit !== undefined &&
    credit.terms.lenderAccount !== input.household
  ) {
    loan = makeLoan({
      ...credit.terms,
      borrowerAccount: input.household,
      unit: input.copper,
      requested: Math.min(shortage, quantity(credit.lenderCopper)),
    });
    if (loan !== undefined) transfers.push(...disburseTransfers(loan));
  }
  const paid = Math.min(fee, cash + (loan?.principal ?? 0));
  if (paid > 0) {
    transfers.push({ unit: input.copper, from: input.household, to: input.provider, amount: paid });
  }
  const fulfillment = Math.min(materialFulfillment, fee > 0 ? paid / fee : 1);
  const weight = Number.isFinite(input.faceWeight) ? Math.max(0, Math.min(1, input.faceWeight)) : 0;
  return {
    transfers,
    ...(loan !== undefined ? { loan } : {}),
    paid,
    unpaid: fee - paid,
    materialsComplete,
    dignified: materialsComplete && paid === fee,
    faceLoss: weight * (1 - fulfillment),
  };
}
