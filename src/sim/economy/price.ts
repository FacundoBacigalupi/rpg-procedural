// Precios de aldea y trato (economy §4, §5, §6 en su forma mínima). No hay un precio del mundo: cada
// parte tiene una reserva que sale de lo que tiene, de cuánto le falta y de lo que cree que vale, y
// el trato es un punto entre las dos (o ninguno). El regateo mueve ese punto con la ventaja de la
// tirada (`edge`). Nadie compra con plata que no tiene ni vende lo que necesita para comer.

/** Lo que come una persona por día (kcal): tres comidas. */
export const DAILY_KCAL = 2400;
/** Cuántos días de comida no vende nadie de lo que le queda en la despensa. */
export const KEEP_DAYS = 60;
/** Hasta cuántos días de comida junta alguien comprando (más que eso, no compra). */
export const WANT_DAYS = 200;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Cuánto sube o baja el precio pedido según lo que le sobra de comida a quien vende. */
export function scarcityFactor(daysOfFood: number): number {
  const t = clamp((daysOfFood - KEEP_DAYS) / (300 - KEEP_DAYS), 0, 1);
  return 1.35 - 0.5 * t; // 1,35 al borde de lo que guarda; 0,85 con la despensa llena
}

/** Lo que pide por kilo quien vende (monedas, sin redondear). */
export function askPerKg(base: number, sellerDays: number): number {
  return base * scarcityFactor(sellerDays);
}

/** Días de comida encima por debajo de los cuales quien compra paga de más por llevársela. */
export const CARRY_DAYS = 30;

/**
 * Lo que ofrece por kilo quien compra: más cuanto menos tiene guardado, y un sobreprecio por la
 * comodidad de llevársela ya si casi no carga comida (`carryDays`, la que lleva encima).
 */
export function bidPerKg(base: number, buyerDays: number, carryDays = CARRY_DAYS): number {
  const need = clamp(1 - buyerDays / WANT_DAYS, 0, 1);
  const portable = 0.5 * clamp(1 - carryDays / CARRY_DAYS, 0, 1);
  return base * (0.7 + 0.5 * need + portable);
}

export interface Deal {
  /** Gramos que cambian de mano. */
  readonly grams: number;
  /** Monedas que van de quien compra a quien vende. */
  readonly coins: number;
}

/**
 * El trato de pasar `wantGrams` de quien vende a quien compra: el vendedor pide `askPerKg` y el
 * comprador no pasa de `maxPerKg`; `edge` (a favor de quien actúa, -0,3 a 0,3) corre el precio
 * dentro de esa zona. Se achica a lo que el vendedor puede dar y el comprador pagar. Sin zona, o
 * sin nada que mover, no hay trato.
 */
export function strike(o: {
  readonly wantGrams: number;
  readonly askPerKg: number;
  readonly maxPerKg: number;
  readonly edge: number;
  readonly availableGrams: number;
  readonly buyerCoins: number;
  /** Quién gana con `edge`: el comprador (actor compra) o el vendedor (actor vende). */
  readonly actorBuys: boolean;
}): Deal | null {
  if (o.askPerKg > o.maxPerKg) return null;
  const share = clamp(0.5 + (o.actorBuys ? -o.edge : o.edge) * 1.5, 0.05, 0.95);
  const perKg = o.askPerKg + (o.maxPerKg - o.askPerKg) * share;
  let grams = Math.min(Math.floor(o.wantGrams), Math.floor(o.availableGrams));
  if (grams <= 0) return null;
  grams = Math.min(grams, Math.floor((o.buyerCoins / perKg) * 1000));
  if (grams <= 0) return null;
  const coins = Math.max(1, Math.round((perKg * grams) / 1000));
  if (coins > o.buyerCoins) return null;
  return { grams, coins };
}

/** Un número y una unidad de peso en una frase ("3 kilos", "500 gramos"); un kilo si no dice. */
export function gramsIn(text: string | null, fallback = 1000): number {
  if (text === null) return fallback;
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|gramos?|gr?)?/i.exec(text);
  if (!m) return fallback;
  const n = Number((m[1] as string).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const unit = (m[2] ?? "").toLowerCase();
  return Math.round(unit.startsWith("g") ? n : n * 1000);
}
