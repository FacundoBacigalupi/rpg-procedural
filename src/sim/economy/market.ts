// Mercado de la aldea (economy §5, «Cómo se forma el precio (modo individual)»). No hay precio del
// mundo: hay una cinta de transacciones (lo que pasó de verdad), cada hogar con sus creencias de
// precio (`PRICE_BELIEFS`) que se corren con lo que vio, pagó o cobró, y un cierre de día en que el
// vendedor sube o baja su pedido según cómo le fue. Parte pura: el cableado a la vida es otro ítem.

import { table } from "../world/index.ts";
import { askPerKg, bidPerKg } from "./price.ts";
import {
  baseFor,
  decayBelief,
  firstBelief,
  observePrice,
  type PriceBelief,
  type PriceBeliefs,
} from "./priceMemory.ts";

/** Una transacción cerrada en el mercado (la verdad; nadie en el mundo ve la cinta entera). */
export interface TapeEntry {
  readonly day: number;
  /** Unidad del ledger (`good:<id>`). */
  readonly unit: string;
  readonly grams: number;
  readonly coins: number;
  readonly seller: string;
  readonly buyer: string;
}

export type Tape = readonly TapeEntry[];

/** La cinta de un lugar de mercado (la verdad), por entidad `place:`; sin lugar, la del vendedor. */
export const MARKET_TAPE = table<Tape>("economy.market_tape");

/** Cuántos días de cinta se guardan (el resto ya es historia agregada). */
export const TAPE_WINDOW_DAYS = 30;

/** Monedas por kilo de una transacción. */
export function perKgOf(e: TapeEntry): number {
  return e.grams > 0 ? (e.coins * 1000) / e.grams : 0;
}

/** Agrega una transacción y descarta las que quedaron fuera de la ventana. Puro. */
export function recordDeal(tape: Tape, entry: TapeEntry): Tape {
  const keep = tape.filter((e) => e.day > entry.day - TAPE_WINDOW_DAYS);
  return [...keep, entry];
}

/** Mediana ponderada por gramos del precio por kilo de un bien en un rango de días (`null` sin datos). */
export function tapePrice(tape: Tape, unit: string, fromDay: number, toDay: number): number | null {
  const rows = tape
    .filter((e) => e.unit === unit && e.day >= fromDay && e.day <= toDay && e.grams > 0)
    .map((e) => ({ p: perKgOf(e), w: e.grams }))
    .sort((a, b) => a.p - b.p);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.w, 0);
  let acc = 0;
  for (const r of rows) {
    acc += r.w;
    if (acc * 2 >= total) return r.p;
  }
  return (rows[rows.length - 1] as { p: number }).p;
}

/** Cuánto pesa lo que uno solo vio de lejos frente a lo que pagó o cobró él mismo. */
export const WITNESS_WEIGHT = 0.5;

/**
 * Las creencias de alguien después de una transacción. Las partes (pagó o cobró) la toman entera;
 * quien solo la vio la toma a mitad de camino entre lo que creía y lo visto.
 */
export function learnFromDeal(
  beliefs: PriceBeliefs | undefined,
  entry: TapeEntry,
  referencePerKg: number,
  role: "party" | "witness",
): PriceBeliefs {
  const prev = beliefs?.[entry.unit];
  const start: PriceBelief =
    prev === undefined ? firstBelief(referencePerKg, entry.day) : decayBelief(prev, entry.day);
  const seen = perKgOf(entry);
  const toward = role === "party" ? seen : start.perKg + (seen - start.perKg) * WITNESS_WEIGHT;
  return { ...beliefs, [entry.unit]: observePrice(start, toward, entry.day) };
}

/** Lo que pasó con un vendedor en el día de mercado, para corregir su creencia. */
export interface SellerDay {
  /** Gramos que sacó a la venta. */
  readonly offeredGrams: number;
  readonly soldGrams: number;
  /** Cuántas veces le regatearon a la baja (compradores que se fueron por el precio). */
  readonly walkedAway: number;
}

/** Cuánto se mueve el pedido en un día (fracción del precio creído). */
const SELLER_STEP = 0.08;

/**
 * Después del día de mercado: quien vendió todo sube su creencia, quien no vendió nada la baja, el
 * intermedio queda. Mueve el número (no la fe) y deja el día visto.
 */
export function endOfDayAdjust(
  beliefs: PriceBeliefs | undefined,
  unit: string,
  referencePerKg: number,
  day: number,
  s: SellerDay,
): PriceBeliefs {
  if (!(s.offeredGrams > 0)) return beliefs ?? {};
  const prev = beliefs?.[unit];
  const start: PriceBelief =
    prev === undefined ? firstBelief(referencePerKg, day) : decayBelief(prev, day);
  const sold = Math.min(1, s.soldGrams / s.offeredGrams);
  const pressure = sold >= 0.9 ? 1 : sold <= 0.1 ? -1 : 0;
  const shove = s.walkedAway > 0 && pressure === 0 ? -0.5 : pressure;
  return { ...beliefs, [unit]: { ...start, perKg: start.perKg * (1 + SELLER_STEP * shove) } };
}

export interface HouseholdQuote {
  readonly ask: number;
  readonly bid: number;
}

/**
 * Lo que un hogar pide y ofrece por kilo de un bien: la base sale de sus creencias (no de la
 * cinta), el pedido sube con la escasez propia y la oferta con la falta propia.
 */
export function householdQuote(
  beliefs: PriceBeliefs | undefined,
  unit: string,
  referencePerKg: number,
  day: number,
  ownDays: number,
): HouseholdQuote {
  const base = baseFor(beliefs, unit, referencePerKg, day);
  return { ask: askPerKg(base, ownDays), bid: bidPerKg(base, ownDays) };
}

/** Lo que un vendedor lleva del día de mercado en curso, por bien (`good:<id>`), con su día. */
export interface SellerDayBook {
  readonly day: number;
  readonly rows: Readonly<Record<string, SellerDay>>;
}

/** El libro del día de cada vendedor (la verdad; el vendedor lo siente, no lo lee), por agente. */
export const SELLER_DAY = table<SellerDayBook>("economy.seller_day");

/**
 * Anota lo que sacó a la venta y lo que vendió. Un libro de un día anterior sigue vivo hasta que
 * el cierre lo procese; acá se agrega al día en curso solo si es el mismo día (si no, es otro
 * libro: lo devuelve el cierre). Puro.
 */
export function noteSeller(
  book: SellerDayBook | undefined,
  day: number,
  unit: string,
  offeredGrams: number,
  soldGrams: number,
): SellerDayBook {
  const base: SellerDayBook = book !== undefined && book.day === day ? book : { day, rows: {} };
  const prev = base.rows[unit] ?? { offeredGrams: 0, soldGrams: 0, walkedAway: 0 };
  const walked = soldGrams < offeredGrams ? 1 : 0;
  return {
    day,
    rows: {
      ...base.rows,
      [unit]: {
        offeredGrams: prev.offeredGrams + offeredGrams,
        soldGrams: prev.soldGrams + soldGrams,
        walkedAway: prev.walkedAway + walked,
      },
    },
  };
}
