// Presupuesto del hogar (economy §3 «El hogar como unidad», §4 valor de reserva). Parte pura: el hogar
// junta ingresos, paga lo fijo (renta, cuota de deuda), aparta para comer y lo que sobra es lo
// que sus miembros pueden gastar sin poner en riesgo la comida. Nada crea ni destruye monedas: solo
// se calcula cuánto se puede mover.

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Cuánto pesa en la mesa cada edad respecto de un adulto (la comida del hogar). */
export const CHILD_FOOD_SHARE = 0.6;
export const ELDER_FOOD_SHARE = 0.8;
/** Días de comida comprada que el hogar aparta antes de gastar en otra cosa. */
export const FOOD_RESERVE_DAYS = 30;
/** Fracción de lo disponible que un hogar gasta en una compra no urgente. */
export const DISCRETIONARY_SHARE = 0.5;
/** Los días de plata por debajo de los cuales el hogar está en apuros. */
export const TIGHT_DAYS = 20;

export interface HouseholdFlows {
  /** Monedas en poder del hogar (suma de lo que tienen sus miembros que comparten bolsa). */
  readonly coins: number;
  /** Ingreso diario medio (jornales, ventas, renta cobrada), en monedas. */
  readonly incomePerDay: number;
  /** Gastos fijos por día: renta, cuota de deuda, impuestos. */
  readonly fixedPerDay: number;
  /** Lo que cuesta comprar la comida de un día de un adulto (según el precio que cree). */
  readonly foodCoinsPerAdultDay: number;
  /** Días de comida propia en la despensa (producción propia ya guardada). */
  readonly pantryDays: number;
  readonly adults: number;
  readonly children: number;
  readonly elders: number;
}

/** Bocas ponderadas: cuántos adultos de comida come el hogar por día. */
export function foodMouths(h: Pick<HouseholdFlows, "adults" | "children" | "elders">): number {
  return h.adults + CHILD_FOOD_SHARE * h.children + ELDER_FOOD_SHARE * h.elders;
}

/** Lo que cuesta alimentar al hogar por día si tuviera que comprar todo. */
export function foodCostPerDay(h: HouseholdFlows): number {
  return foodMouths(h) * h.foodCoinsPerAdultDay;
}

/** Flujo neto por día (ingreso - fijo - comida a comprar; la despensa propia no se compra). */
export function netPerDay(h: HouseholdFlows): number {
  const buyShare = h.pantryDays > 0 ? 0 : 1;
  return h.incomePerDay - h.fixedPerDay - buyShare * foodCostPerDay(h);
}

/** Días que aguanta el hogar con la plata que tiene si el neto es negativo (Infinity si no se gasta). */
export function runwayDays(h: HouseholdFlows): number {
  const net = netPerDay(h);
  if (net >= 0) return Number.POSITIVE_INFINITY;
  return h.coins / -net;
}

export type HouseholdStanding = "comfortable" | "getting-by" | "tight" | "broke";

/** Cómo está el hogar, para que lo lean decisiones, rumores y la narración. */
export function standing(h: HouseholdFlows): HouseholdStanding {
  if (h.coins <= 0 && netPerDay(h) < 0 && h.pantryDays <= 0) return "broke";
  const r = runwayDays(h);
  if (r < TIGHT_DAYS) return "tight";
  if (netPerDay(h) < 0 || r < 3 * TIGHT_DAYS) return "getting-by";
  return "comfortable";
}

/**
 * La plata que el hogar puede gastar sin tocar la reserva de comida. Si la despensa propia no
 * cubre la reserva, aparta `FOOD_RESERVE_DAYS` de comida comprada (en proporción a lo que falta).
 */
export function availableCoins(h: HouseholdFlows): number {
  const missing = clamp(1 - h.pantryDays / FOOD_RESERVE_DAYS, 0, 1);
  const reserve =
    missing * FOOD_RESERVE_DAYS * foodCostPerDay(h) + FOOD_RESERVE_DAYS * h.fixedPerDay * 0.25;
  return Math.max(0, h.coins - reserve);
}

/** Tope de gasto de una compra: lo urgente puede usar todo lo que hay; lo demás, una parte de lo libre. */
export function spendCeiling(h: HouseholdFlows, urgent: boolean): number {
  return urgent ? Math.max(0, h.coins) : availableCoins(h) * DISCRETIONARY_SHARE;
}

/** Cuánto ahorra por día un hogar con neto positivo, según su apego a guardar (0 a 1). */
export function savingsPerDay(h: HouseholdFlows, thrift: number): number {
  return Math.max(0, netPerDay(h)) * clamp(thrift, 0, 1);
}

/**
 * Reparte un ingreso entre los miembros que lo aportaron: cada uno entrega `pooled` (fracción) a
 * la bolsa común y se queda con el resto. Conserva el total.
 */
export function poolIncome(
  earned: readonly { readonly id: string; readonly coins: number; readonly pooled: number }[],
): { readonly pot: number; readonly kept: ReadonlyMap<string, number> } {
  let pot = 0;
  const kept = new Map<string, number>();
  for (const e of earned) {
    const give = Math.floor(e.coins * clamp(e.pooled, 0, 1));
    pot += give;
    kept.set(e.id, e.coins - give);
  }
  return { pot, kept };
}
