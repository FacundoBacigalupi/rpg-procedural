// Empeño (contracts §5, economy §8): la casa de empeño recibe un lote del ledger en prenda y presta
// una fracción de su valor creído, con plazo. Si el dueño paga lo debido (adelanto más interés) antes
// de que venza (y la gracia), recupera el lote; si no, el lote pasa a la casa (`seize`: la prenda
// ya está en sus manos, `held: "creditor"`). Es un `Commitment` de tipo `pawn` con una obligación
// de entregar y un colateral en poder del acreedor. Todo puro, sin RNG ni reloj: quien llama pone
// el valor creído y los días, y mueve los lotes por el ledger con `pawnTransfers`.

import { type Commitment, commitmentOwed } from "./commitment.ts";
import { seize } from "./restructure.ts";

export const PAWN_KIND = "pawn";
/** Fracción del valor creído que adelanta la casa (por defecto). */
export const PAWN_ADVANCE = 0.5;
/** Plazo por defecto en días de mundo y gracia pasado el plazo. */
export const PAWN_TERM_DAYS = 30;
export const PAWN_GRACE_DAYS = 3;

export interface PawnInput {
  readonly id: string;
  /** Hogares (cuentas) del dueño de la prenda y de la casa. */
  readonly pawner: string;
  readonly broker: string;
  /** Referencia de la prenda (`lot:...`) que queda en manos de la casa. */
  readonly ref: string;
  /** Unidad del préstamo (la que se adelanta y se devuelve). */
  readonly unit: string;
  /** Valor creído de la prenda por la casa, en la unidad del préstamo. */
  readonly believedValue: number;
  readonly day: number;
  readonly originEventId: string;
  readonly advance?: number;
  /** Interés del plazo (fracción del adelanto). */
  readonly rate?: number;
  readonly termDays?: number;
}

export interface PawnOffer {
  readonly advance: number;
  readonly owed: number;
}

/** Lo que adelanta la casa y lo que debe devolver el dueño para recuperar el lote. */
export function pawnOffer(
  believedValue: number,
  advance = PAWN_ADVANCE,
  rate = 0,
): PawnOffer | null {
  const loan = Math.floor(Math.max(0, believedValue) * Math.min(1, Math.max(0, advance)));
  if (loan <= 0) return null;
  return { advance: loan, owed: Math.ceil(loan * (1 + Math.max(0, rate)) - 1e-9) };
}

/** Abre el empeño: el compromiso (obligación del dueño, prenda en la casa) y la oferta. */
export function openPawn(
  i: PawnInput,
): { readonly commitment: Commitment; readonly offer: PawnOffer } | null {
  const offer = pawnOffer(i.believedValue, i.advance, i.rate);
  if (!offer) return null;
  const endDay = i.day + (i.termDays ?? PAWN_TERM_DAYS);
  return {
    offer,
    commitment: {
      id: i.id,
      kind: PAWN_KIND,
      basis: "agreement",
      parties: [
        { ref: i.pawner, role: "pawner" },
        { ref: i.broker, role: "broker" },
      ],
      obligations: [
        {
          id: `${i.id}:redeem`,
          debtor: i.pawner,
          creditor: i.broker,
          duty: { kind: "deliver", unit: i.unit, qty: offer.owed },
          dueDay: endDay,
          state: "pending",
          performed: 0,
        },
      ],
      guarantees: [{ kind: "collateral", ref: i.ref, held: "creditor" }],
      enforcers: [{ kind: "guarantee", reads: "truth" }],
      status: "active",
      term: { startDay: i.day, endDay },
      originEventId: i.originEventId,
      history: [`pawned:${offer.advance}`],
    },
  };
}

/** Las transferencias de abrir: el lote al de la casa y el adelanto al dueño. */
export function pawnTransfers(
  i: Pick<PawnInput, "pawner" | "broker" | "unit">,
  lot: { readonly unit: string; readonly amount: number },
  offer: PawnOffer,
): readonly { unit: string; from: string; to: string; amount: number }[] {
  return [
    { unit: lot.unit, from: i.pawner, to: i.broker, amount: lot.amount },
    { unit: i.unit, from: i.broker, to: i.pawner, amount: offer.advance },
  ];
}

export type PawnPhase = "open" | "grace" | "forfeit" | "closed";

/** Dentro del plazo, en gracia, o vencido de verdad (el lote es de la casa). */
export function pawnPhase(c: Commitment, day: number): PawnPhase {
  if (c.kind !== PAWN_KIND || c.status !== "active") return "closed";
  if (day <= c.term.endDay) return "open";
  return day <= c.term.endDay + PAWN_GRACE_DAYS ? "grace" : "forfeit";
}

/** El dueño paga `grams`: se aplica a lo debido; con la deuda cubierta el lote vuelve. */
export function redeemPawn(
  c: Commitment,
  grams: number,
): { readonly commitment: Commitment; readonly applied: number; readonly redeemed: boolean } {
  const owed = commitmentOwed(c);
  const applied = Math.max(0, Math.min(owed, grams));
  if (c.kind !== PAWN_KIND || c.status !== "active" || applied <= 0)
    return { commitment: c, applied: 0, redeemed: false };
  let left = applied;
  const obligations = c.obligations.map((o) => {
    const pay = Math.min(left, Math.max(0, o.duty.qty - o.performed));
    left -= pay;
    if (pay <= 0) return o;
    const performed = o.performed + pay;
    return {
      ...o,
      performed,
      state: performed >= o.duty.qty - 1e-9 ? ("fulfilled" as const) : ("partial" as const),
    };
  });
  const redeemed = owed - applied <= 1e-9;
  return {
    commitment: {
      ...c,
      obligations,
      status: redeemed ? "fulfilled" : "active",
      guarantees: redeemed ? c.guarantees.filter((g) => g.kind !== "collateral") : c.guarantees,
      history: [...c.history, redeemed ? `redeemed:${applied}` : `paid:${applied}`],
    },
    applied,
    redeemed,
  };
}

/**
 * Vencido: el lote pasa a la casa (`seize` sobre la prenda, que ya tiene). El lote entero es
 * suyo aunque valga más que lo debido; `taken` es lo que abona a la deuda.
 */
export function forfeitPawn(c: Commitment, lotValue: number, ref: string) {
  const out = seize(c, new Map([[ref, Math.max(0, lotValue)]]));
  return {
    ...out,
    commitment: {
      ...out.commitment,
      guarantees: out.commitment.guarantees.filter((g) => g.kind !== "collateral" || g.ref !== ref),
    },
  };
}
