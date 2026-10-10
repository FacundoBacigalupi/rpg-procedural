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

/** Una renta que el hogar cobra (arriendo, aparcería, canon): monedas por día en un rango de días. */
export interface RentCollected {
  readonly perDay: number;
  /** Primer día en que se cobra (inclusive). */
  readonly fromDay: number;
  /** Día en que deja de cobrarse (exclusive); sin él, sigue. */
  readonly untilDay?: number;
}

/** La renta diaria que entra el día `today`: suma de las rentas vigentes (nunca negativa). */
export function rentIncomePerDay(rents: readonly RentCollected[], today: number): number {
  let sum = 0;
  for (const r of rents) {
    if (today >= r.fromDay && (r.untilDay === undefined || today < r.untilDay)) {
      sum += Math.max(0, r.perDay);
    }
  }
  return sum;
}

/** Los flujos con la renta cobrada sumada al ingreso; sin rentas vigentes devuelve los mismos flujos. */
export function withRentIncome(
  h: HouseholdFlows,
  rents: readonly RentCollected[],
  today: number,
): HouseholdFlows {
  const extra = rentIncomePerDay(rents, today);
  return extra === 0 ? h : { ...h, incomePerDay: h.incomePerDay + extra };
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

/** Cuánto baja lo que pide quien vende estando apretado o en la ruina (necesita monedas ya). */
export const DISTRESS_ASK_FACTOR: Readonly<Record<HouseholdStanding, number>> = {
  comfortable: 1,
  "getting-by": 1,
  tight: 0.9,
  broke: 0.75,
};

/** Cuánto baja lo que ofrece quien compra estando apretado o en la ruina (regatea más duro). */
export const DISTRESS_BID_FACTOR: Readonly<Record<HouseholdStanding, number>> = {
  comfortable: 1,
  "getting-by": 1,
  tight: 0.9,
  broke: 0.75,
};

/** Cómo está un hogar frente a un trato, tal como lo ve el resolvedor de `trade`. */
export interface DealBudget {
  /** Tope de gasto de una compra no urgente. */
  readonly coinCeiling: number;
  /** Tope de gasto si lo que compra es urgente (comida que falta): todo lo que hay. */
  readonly urgentCeiling: number;
  readonly standing: HouseholdStanding;
}

/** Solo apretado o en la ruina se nota en un trato (lo que narra y lo que mueve el precio). */
export function strainOf(s: HouseholdStanding): "tight" | "broke" | undefined {
  return s === "tight" || s === "broke" ? s : undefined;
}

/** Aporte base a la bolsa común (el 70% fijo de antes), de donde parte `personalPoolShare`. */
export const BASE_POOL_SHARE = 0.7;
/** Cuánto suma a lo aportado cada unidad de calidez (eje -1 a 1) y cuánto resta la de control (guarda). */
export const POOL_WARMTH_WEIGHT = 0.1;
export const POOL_CONTROL_WEIGHT = 0.08;
/** Lo que suma cada dependiente (niño o viejo) por adulto del hogar, y el tope de ese aporte. */
export const POOL_DEPENDENT_WEIGHT = 0.1;
export const POOL_DEPENDENT_CAP = 0.2;
/** Piso y techo del aporte: nadie da todo ni se queda con todo. */
export const POOL_SHARE_MIN = 0.3;
export const POOL_SHARE_MAX = 0.95;

/**
 * Qué parte de su jornal aporta alguien a la bolsa común (0 a 1): más si es cálido o si en su casa
 * hay más bocas dependientes por adulto; menos si es de guardar (control alto). Sin RNG.
 */
export function personalPoolShare(
  temperament: { readonly warmth?: number; readonly control?: number },
  household: Pick<HouseholdFlows, "adults" | "children" | "elders">,
): number {
  const dependents = household.children + household.elders;
  const perAdult = dependents / Math.max(1, household.adults);
  const share =
    BASE_POOL_SHARE +
    POOL_WARMTH_WEIGHT * clamp(temperament.warmth ?? 0, -1, 1) -
    POOL_CONTROL_WEIGHT * clamp(temperament.control ?? 0, -1, 1) +
    clamp(POOL_DEPENDENT_WEIGHT * perAdult, 0, POOL_DEPENDENT_CAP);
  return clamp(share, POOL_SHARE_MIN, POOL_SHARE_MAX);
}
