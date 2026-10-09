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
  /** Poder de negociación del oyente (contracts §3); sin esto, neutro. */
  readonly leverage?: Leverage;
}

/**
 * Lo que mueve el margen además de la calidez (contracts §3, economy §8): las alternativas que el
 * oyente cree tener (0-1: otro le compraría o le vendería lo mismo), su desesperación (0-1: necesita
 * lo que recibiría) y la cara en juego (0-1: ceder rápido lo dejaría mal ante otros).
 */
export interface Leverage {
  readonly alternatives: number;
  readonly desperation: number;
  readonly face: number;
}

/** Cuánto pesa cada palanca en el margen (sin calibrar). */
export const ALTERNATIVES_MARGIN = 0.2;
export const DESPERATION_MARGIN = 0.3;
export const FACE_MARGIN = 0.1;

const unit = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/** Cuánto sube (o baja) el margen por el poder de negociación del oyente. */
export function leverageShift(l: Leverage | undefined): number {
  if (!l) return 0;
  return (
    ALTERNATIVES_MARGIN * unit(l.alternatives) -
    DESPERATION_MARGIN * unit(l.desperation) +
    FACE_MARGIN * unit(l.face)
  );
}

/** Con cuántas casas dispuestas a tratar la alternativa es total (sin calibrar). */
export const ALTERNATIVE_HOUSES = 3;
/** Con cuántos testigos la cara en juego al regatear es plena. */
export const BARGAIN_WITNESSES = 3;

/**
 * Las alternativas creídas (0-1) al comprar o vender un bien: cuántas otras casas lo tienen de
 * sobra (`buy`: le podrían vender) o les falta (`sell`: le podrían comprar), según lo que se sabe
 * de cada una (`stock` en gramos, con su reserva por miembros).
 */
export function alternativesAmong(
  houses: readonly { readonly stock: number; readonly members: number }[],
  side: "buy" | "sell",
  reservePerMember: number,
  minSpare: number,
): number {
  let n = 0;
  for (const h of houses) {
    const spare = h.stock - h.members * reservePerMember;
    if (side === "buy" ? spare >= minSpare : spare < 0) n++;
  }
  return unit(n / ALTERNATIVE_HOUSES);
}

/**
 * La cara en juego (0-1) al ceder en un trato: pesa con los testigos y se duplica si el oyente
 * no está por debajo de quien propone (a quien tiene rango le cuesta más quedar mal).
 */
export function bargainFace(witnesses: number, hearerRank: number, speakerRank: number): number {
  const seen = unit(Math.max(0, witnesses) / BARGAIN_WITNESSES);
  return unit(seen * (hearerRank >= speakerRank ? 1 : 0.5));
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

export function offerMargin(felt: number, leverage?: Leverage): number {
  return Math.min(
    MAX_MARGIN,
    Math.max(MIN_MARGIN, BASE_MARGIN - WARMTH_MARGIN * felt + leverageShift(leverage)),
  );
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
  const asked = lost * (1 + offerMargin(i.felt, i.leverage));
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
