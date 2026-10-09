// Propuestas de intercambio (dialogue §2, §8): un `offer` es un trato que el oyente evalúa con lo
// que cree que vale cada cosa (su reserva, no un precio del mundo), lo que quiere a quien propone y
// lo que le sobra. Puede aceptar, contraofertar (pide menos de lo que se le pidió, o más de lo que
// se le da) o rechazar. Un `accept` o `refuse` contesta a la propuesta abierta entre los dos. La
// función es pura: devuelve la decisión; mover los bienes es de quien la cablea (con el ledger).

import type { ExchangeTerm } from "./acts.ts";

/** Una propuesta abierta: lo que el oyente recibiría (`gets`) y lo que daría (`gives`). */
export interface Proposal {
  readonly gets: ExchangeTerm | null;
  readonly gives: ExchangeTerm | null;
}

/** Margen que pide el oyente sobre lo que cede (fracción), con calidez neutra. */
export const BASE_MARGIN = 0.15;
/** Cuánto baja el margen la calidez hacia quien propone (y sube con el recelo). */
export const WARMTH_MARGIN = 0.2;
export const MIN_MARGIN = -0.1;
export const MAX_MARGIN = 0.4;
/** Fracción del valor pedido por debajo de la cual ni se contraoferta: se rechaza. */
export const COUNTER_FLOOR = 0.6;

export type OfferVerdict =
  | { readonly kind: "unvalued" }
  | { readonly kind: "short" }
  | { readonly kind: "gift"; readonly deal: Proposal }
  | { readonly kind: "accept"; readonly deal: Proposal }
  | { readonly kind: "counter"; readonly counter: Proposal }
  | { readonly kind: "reject" };

export interface OfferInput {
  /** Lo que quien habla da (el oyente recibe) y lo que quiere (el oyente da). */
  readonly give: ExchangeTerm | null;
  readonly want: ExchangeTerm | null;
  /** Cuánto cree el oyente que vale el kilo del bien (monedas); null si no sabe valuarlo. */
  readonly worth: (good: string) => number | null;
  /** Gramos del bien que el oyente puede dar sin tocar su reserva. */
  readonly spare: (good: string) => number;
  /** Gramos que quien habla tiene a mano de un bien (no puede dar lo que no tiene). */
  readonly speakerHas: (good: string) => number;
  /** Calidez efectiva del oyente hacia quien propone (`warmth` + recuerdos). */
  readonly felt: number;
}

/** Rondas de contraofertas (propuesta y contrapropuesta) que aguanta el oyente antes de cansarse. */
export const MAX_ROUNDS = 3;

/**
 * Si un trato abierto sigue siendo posible al aceptarlo: el oyente todavía puede dar lo que ofreció
 * (sin tocar su reserva) y quien acepta todavía tiene lo que prometió (conservación: nadie da lo
 * que ya no tiene).
 */
export function dealHolds(
  deal: Proposal,
  spare: (good: string) => number,
  speakerHas: (good: string) => number,
): boolean {
  if (deal.gives !== null && spare(deal.gives.good) < deal.gives.grams) return false;
  if (deal.gets !== null && speakerHas(deal.gets.good) < deal.gets.grams) return false;
  return true;
}

export function offerMargin(felt: number): number {
  return Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, BASE_MARGIN - WARMTH_MARGIN * felt));
}

const value = (t: ExchangeTerm, worth: (g: string) => number | null): number | null => {
  const w = worth(t.good);
  return w === null ? null : (t.grams / 1000) * w;
};

/** Qué hace el oyente con la propuesta (ni el rencor ni las deudas: eso lo cierra `decideReply`). */
export function weighOffer(i: OfferInput): OfferVerdict {
  const { give, want } = i;
  if (give === null && want === null) return { kind: "unvalued" };
  if (give !== null && i.speakerHas(give.good) < give.grams) return { kind: "short" };
  if (want !== null && i.spare(want.good) < want.grams) return { kind: "short" };
  if (want === null && give !== null) {
    return { kind: "gift", deal: { gets: give, gives: null } };
  }
  if (give === null || want === null) return { kind: "unvalued" };
  const got = value(give, i.worth);
  const lost = value(want, i.worth);
  if (got === null || lost === null || lost <= 0) return { kind: "unvalued" };
  const asked = lost * (1 + offerMargin(i.felt));
  if (got >= asked) return { kind: "accept", deal: { gets: give, gives: want } };
  if (got >= COUNTER_FLOOR * asked) {
    // Da lo que alcanza a pagar lo recibido, con el margen puesto.
    const grams = Math.floor((want.grams * got) / asked);
    if (grams > 0) {
      return { kind: "counter", counter: { gets: give, gives: { good: want.good, grams } } };
    }
  }
  return { kind: "reject" };
}
