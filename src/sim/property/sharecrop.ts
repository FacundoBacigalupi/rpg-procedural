// Aparcería (property §6): el canon es una parte de lo cosechado en la parcela, no monedas fijas.
// La proporción del dueño depende de quién pone qué (tierra, semilla, bueyes, herramientas; el
// trabajo siempre lo pone el aparcero). Parte pura, sin estado ni RNG: calcula la fracción, la
// parte de una cosecha y el asiento del ledger que la pasa del aparcero al dueño. Lo que el
// aparcero no puede entregar queda como atraso (la deuda que lo ata). Conserva: solo mueve lo que
// hay en la cuenta del aparcero.

import type { LedgerAccount, LedgerUnit, Transfer } from "../../core/index.ts";

/** Quién aporta cada insumo de la parcela; `true` es el dueño, `false` el aparcero. */
export interface SharecropInputs {
  readonly seed: boolean;
  readonly oxen: boolean;
  readonly tools: boolean;
}

/** Fracción base del dueño por poner la tierra (sin lo demás). */
export const SHARECROP_LAND_BASE = 0.25;
/** Lo que suma cada insumo que pone el dueño. */
export const SHARECROP_SEED_SHARE = 0.1;
export const SHARECROP_OXEN_SHARE = 0.1;
export const SHARECROP_TOOLS_SHARE = 0.05;

/** Fracción de la cosecha que le toca al dueño, entre 0,25 (solo tierra) y 0,5 (todo menos el trabajo). */
export function sharecropFraction(inputs: SharecropInputs): number {
  return (
    SHARECROP_LAND_BASE +
    (inputs.seed ? SHARECROP_SEED_SHARE : 0) +
    (inputs.oxen ? SHARECROP_OXEN_SHARE : 0) +
    (inputs.tools ? SHARECROP_TOOLS_SHARE : 0)
  );
}

/** Parte entera del dueño en una cosecha de `harvested` unidades; el redondeo queda para el aparcero. */
export function sharecropOwed(harvested: number, fraction: number): number {
  if (!(harvested > 0) || !(fraction > 0)) return 0;
  return Math.floor(harvested * Math.min(1, fraction));
}

export interface SharecropSettlement {
  /** Lo que correspondía al dueño de esta cosecha. */
  readonly owed: number;
  /** Lo que el aparcero entregó (nunca más de lo que tenía ni de lo cosechado). */
  readonly paid: number;
  /** Lo que quedó debiendo. */
  readonly arrears: number;
  /** Asiento del ledger (vacío si no se paga nada). */
  readonly transfers: readonly Transfer[];
}

/**
 * Liquida una cosecha: el aparcero entrega la parte del dueño (más el atraso anterior) de lo que
 * tiene en su cuenta. `available` es lo que hay en la cuenta del aparcero de ese bien.
 */
export function settleSharecrop(args: {
  readonly harvested: number;
  readonly fraction: number;
  readonly priorArrears?: number;
  readonly available: number;
  readonly unit: LedgerUnit;
  readonly tenant: LedgerAccount;
  readonly landlord: LedgerAccount;
}): SharecropSettlement {
  const owed = sharecropOwed(args.harvested, args.fraction);
  const due = owed + Math.max(0, args.priorArrears ?? 0);
  const paid = Math.max(0, Math.min(due, Math.floor(args.available)));
  const transfers: Transfer[] =
    paid > 0 ? [{ unit: args.unit, from: args.tenant, to: args.landlord, amount: paid }] : [];
  return { owed, paid, arrears: due - paid, transfers };
}
