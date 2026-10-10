// Prohibiciones de usura que disfrazan el interés (economy §8, contracts §6): donde la norma
// cultural prohíbe cobrar interés, el prestamista no deja de cobrarlo, lo esconde en otra forma.
// `disguiseInterest` convierte una tasa deseada (por plazo) en términos disfrazados, `effectiveRate`
// calcula la tasa real que esos términos esconden y `estimateDisguise` es lo que puede inferir un
// tercero o ejecutor que mira el trato desde afuera (con su propio error al tasar). Todo puro,
// sin RNG ni reloj; las constantes no están calibradas.

import { pow } from "../../core/math/index.ts";

export type DisguiseKind =
  /** Venta con recompra: el prestamista "compra" una prenda al precio del préstamo y la revende más cara. */
  | "buyback"
  /** Precio inflado: vende a crédito algo que vale el préstamo, a un precio mayor. */
  | "inflated_price"
  /** Regalo obligado: devuelve lo prestado y, "por gratitud", un regalo. */
  | "gift"
  /** Trabajo: devuelve lo prestado y además trabaja días para el prestamista. */
  | "labor";

export const DISGUISE_KINDS: readonly DisguiseKind[] = [
  "buyback",
  "inflated_price",
  "gift",
  "labor",
];

export interface DisguiseInput {
  /** Lo que el deudor recibe de verdad, en valor de mercado. */
  readonly principal: number;
  /** Tasa deseada sobre todo el plazo (0,2 = 20% al vencer). */
  readonly rate: number;
  readonly termDays: number;
  readonly kind: DisguiseKind;
  /** Jornal de mercado (valor por día), necesario para `labor`. */
  readonly wagePerDay?: number;
}

export interface DisguisedTerms {
  readonly kind: DisguiseKind;
  readonly termDays: number;
  /** Valor de mercado de lo que recibe el deudor. */
  readonly received: number;
  /** Lo que figura como pago en dinero (precio de recompra, precio inflado o la devolución). */
  readonly moneyDue: number;
  /** Regalo obligado, en valor (solo `gift`). */
  readonly giftValue: number;
  /** Días de trabajo debidos (solo `labor`). */
  readonly laborDays: number;
  /** Jornal con que se valúa el trabajo. */
  readonly wagePerDay: number;
  /** Lo que figura "en el papel" como interés: siempre 0. */
  readonly statedRate: number;
  /** Cómo se llama el trato de cara a la norma. */
  readonly label: string;
}

const LABELS: Record<DisguiseKind, string> = {
  buyback: "venta con recompra",
  inflated_price: "venta a crédito",
  gift: "préstamo con regalo de gratitud",
  labor: "préstamo con servicio",
};

/** Convierte una tasa deseada en términos que no dicen "interés". */
export function disguiseInterest(i: DisguiseInput): DisguisedTerms {
  const rate = Math.max(0, i.rate);
  const wage = Math.max(0, i.wagePerDay ?? 0);
  const principal = Math.max(0, i.principal);
  const extra = principal * rate;
  const base = {
    kind: i.kind,
    termDays: Math.max(1, i.termDays),
    received: principal,
    giftValue: 0,
    laborDays: 0,
    wagePerDay: wage,
    statedRate: 0,
    label: LABELS[i.kind],
  };
  switch (i.kind) {
    case "buyback":
    case "inflated_price":
      return { ...base, moneyDue: principal + extra };
    case "gift":
      return { ...base, moneyDue: principal, giftValue: extra };
    case "labor": {
      // Sin jornal de referencia no se puede cobrar en trabajo: queda el monto en dinero.
      if (wage <= 0) return { ...base, moneyDue: principal + extra };
      return { ...base, moneyDue: principal, laborDays: extra / wage };
    }
  }
}

/** Todo lo que el deudor entrega, en valor. */
export function disguiseOwed(t: DisguisedTerms): number {
  return t.moneyDue + t.giftValue + t.laborDays * t.wagePerDay;
}

/** Tasa real sobre todo el plazo. */
export function effectiveRate(t: DisguisedTerms): number {
  if (t.received <= 0) return 0;
  return disguiseOwed(t) / t.received - 1;
}

/** Tasa real anualizada (compuesta sobre 365 días). */
export function effectiveAnnualRate(t: DisguisedTerms): number {
  const r = effectiveRate(t);
  return pow(1 + r, 365 / t.termDays) - 1;
}

/** Lo que mira un tercero: el trato sin su etiqueta. */
export interface DealObservation {
  readonly kind?: DisguiseKind;
  /** Lo que el observador cree que vale lo que recibió el deudor. */
  readonly believedReceivedValue: number;
  /** Lo que ve que debe entregar en dinero. */
  readonly moneyDue: number;
  readonly giftValue?: number;
  readonly laborDays?: number;
  readonly believedWagePerDay?: number;
  readonly termDays: number;
}

export interface DisguiseEstimate {
  /** Tasa implícita sobre el plazo, según lo que el observador cree. */
  readonly impliedRate: number;
  /** Cuánto pasa la tasa implícita de lo que tolera la norma. */
  readonly excess: number;
  /** Si el observador cree que hay un interés escondido. */
  readonly suspected: boolean;
}

/**
 * Un tercero o ejecutor estima si el trato esconde interés: compara lo que cree que valió lo
 * recibido con todo lo que se debe. `tolerance` es la tasa por plazo que la norma deja pasar
 * (gastos, cortesía); sobre eso, el trato es sospechoso. Si el observador tasa mal lo recibido,
 * estima mal: eso es lo que se le pasa a `believedReceivedValue`.
 */
export function estimateDisguise(o: DealObservation, tolerance = 0.05): DisguiseEstimate {
  if (o.believedReceivedValue <= 0) return { impliedRate: 0, excess: 0, suspected: false };
  const owed = o.moneyDue + (o.giftValue ?? 0) + (o.laborDays ?? 0) * (o.believedWagePerDay ?? 0);
  const impliedRate = owed / o.believedReceivedValue - 1;
  const excess = impliedRate - Math.max(0, tolerance);
  return { impliedRate, excess, suspected: excess > 0 };
}

/**
 * Qué disfraz elige el prestamista: el que menos se nota con lo que tiene a mano. `visibility`
 * es cuánto llama la atención cada uno (0-1, por cultura); sin dato vale el orden por defecto
 * (el regalo es lo que menos se nota, el trabajo lo que más). Empata por el orden de `DISGUISE_KINDS`.
 */
export function chooseDisguise(
  available: readonly DisguiseKind[],
  visibility: Partial<Record<DisguiseKind, number>> = {},
): DisguiseKind | undefined {
  const base: Record<DisguiseKind, number> = {
    gift: 0.2,
    buyback: 0.4,
    inflated_price: 0.5,
    labor: 0.7,
  };
  let best: DisguiseKind | undefined;
  let bestV = Number.POSITIVE_INFINITY;
  for (const k of DISGUISE_KINDS) {
    if (!available.includes(k)) continue;
    const v = visibility[k] ?? base[k];
    if (v < bestV) {
      best = k;
      bestV = v;
    }
  }
  return best;
}
