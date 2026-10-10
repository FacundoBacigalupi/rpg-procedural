// Estafa sobre la calidad percibida (economy §6): el vendedor que conoce la calidad real puede
// ofrecerla mejor de lo que es; el comprador la ve con error según su ojo y paga por lo que cree.
// La mentira deja huella: el lote existe y se descubre al usarlo, al tasarlo o por un tercero.
// Puro: no toca el ledger ni el rng (la tirada la pone quien llama).

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { exp } from "../../core/math/index.ts";
import { table } from "../world/index.ts";
import { perceivedQuality, qualityPriceFactor } from "./quality.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Insumos de la política de quién estafa y cuánto (todo 0-1). */
export interface InflateInputs {
  /** Honestidad del temperamento: 1 nunca infla. */
  readonly honesty: number;
  /** Audacia: el audaz se anima a inflar más. */
  readonly boldness: number;
  /** Necesidad (hambre, deuda): la carencia empuja a estafar. */
  readonly need: number;
  /** Cuánto le importa el comprador (afecto/vínculo, 0-1): al querido no se le estafa. */
  readonly care?: number;
}

/** Por debajo de esta propensión no estafa: la honestidad plena y la saciedad lo dejan en cero. */
export const SCAM_FLOOR = 0.15;
/** Tope de lo que se atreve a mejorar un lote. */
export const SCAM_MAX_INFLATE = 0.4;

/**
 * Cuánto mejora el vendedor lo que ofrece (0 = honesto). Propensión = deshonestidad ponderada por
 * la necesidad; el que quiere al comprador no estafa. Puro y monótono: más necesidad, menos
 * honestidad o más audacia nunca inflan menos.
 */
export function inflateFor(i: InflateInputs): number {
  const dishonest = 1 - clamp(i.honesty, 0, 1);
  const drive =
    dishonest * (0.4 + 0.6 * clamp(i.need, 0, 1)) * (1 - 0.9 * clamp(i.care ?? 0, 0, 1));
  if (drive < SCAM_FLOOR) return 0;
  return clamp(drive * (0.5 + clamp(i.boldness, 0, 1)) * SCAM_MAX_INFLATE, 0, SCAM_MAX_INFLATE);
}

/**
 * Cuánto le cree el comprador al vendedor (0-1) según lo que siente por él: la confianza
 * (-1..1) pesa más, el afecto y el respeto suman y el resentimiento resta. El extraño (todo en
 * su base) queda cerca de 0.5.
 */
export function trustFromRelation(dims: {
  readonly trust?: number;
  readonly affection?: number;
  readonly respect?: number;
  readonly resentment?: number;
}): number {
  const x =
    0.5 +
    0.35 * (dims.trust ?? 0) +
    0.1 * (dims.affection ?? 0) +
    0.05 * (dims.respect ?? 0) -
    0.2 * clamp(dims.resentment ?? 0, 0, 1);
  return clamp(x, 0, 1);
}

/** Lo que el vendedor dice del lote: la real más lo que infla (0 = honesto), con tope en 1. */
export function claimedQuality(real: number, inflate: number): number {
  return clamp(real + Math.max(0, inflate), 0, 1);
}

/**
 * Lo que el comprador cree del lote ofrecido: su propia mirada (error según el ojo) sesgada hacia
 * lo que le dicen en proporción a cuánto confía en el vendedor (0-1). Sin confianza manda su ojo;
 * con ojo perfecto y poca confianza ve la real.
 */
export function believedQuality(
  real: number,
  claimed: number,
  eye: number,
  noise: number,
  trust: number,
): number {
  const own = perceivedQuality(real, eye, noise);
  const pull = clamp(trust, 0, 1) * (1 - clamp(eye, 0, 1));
  return clamp(own + (claimed - own) * pull, 0, 1);
}

/** Cuánto gana el vendedor por kilo (en múltiplo del precio de referencia) con lo que el comprador cree. */
export function scamMargin(real: number, believed: number): number {
  return qualityPriceFactor(believed) - qualityPriceFactor(real);
}

/** Es estafa si lo que cree el comprador supera a la real por más que el margen de error tolerado. */
export function isScam(real: number, believed: number, tolerance = 0.05): boolean {
  return believed - real > tolerance;
}

/**
 * Probabilidad (0-1) de descubrir la diferencia: crece con la brecha, con el ojo, con el uso del
 * lote (días de consumo o de oficio) y con un tasador pagado (`appraised`). Sin brecha es 0.
 */
export function discoveryChance(
  real: number,
  believed: number,
  eye: number,
  usedDays: number,
  appraised = false,
): number {
  const gap = Math.max(0, believed - real);
  if (gap <= 0) return 0;
  const use = 1 - exp(-Math.max(0, usedDays) / 10);
  const p = gap * (0.5 + clamp(eye, 0, 1)) * (0.3 + 0.7 * use) + (appraised ? 0.5 : 0);
  return clamp(p, 0, 1);
}

/** Resultado de descubrirla: el agravio y lo que cae la confianza del comprador en el vendedor. */
export interface ScamAftermath {
  /** Agravio para la relación (0-1), crece con la brecha de calidad y con la confianza traicionada. */
  readonly grievance: number;
  /** Cuánto baja la confianza del comprador en el vendedor (0-1). */
  readonly trustDrop: number;
  /** Lo que el comprador pagó de más por kilo, en múltiplo del precio de referencia (reclamo posible). */
  readonly overpaid: number;
}

export function scamAftermath(real: number, believed: number, trust: number): ScamAftermath {
  const gap = Math.max(0, believed - real);
  const t = clamp(trust, 0, 1);
  return {
    grievance: clamp(gap * (1 + t), 0, 1),
    trustDrop: clamp(gap * 2 * (0.5 + t), 0, 1),
    overpaid: Math.max(0, scamMargin(real, believed)),
  };
}

/** Un trato inflado que quedó sin descubrir: lo que el comprador creyó contra lo que el lote es. */
export interface ScamDeal {
  /** El evento del trato (causa de todo lo que venga de descubrirlo). */
  readonly event: EventId;
  readonly tick: Tick;
  readonly seller: AgentId;
  readonly unit: string;
  readonly grams: number;
  readonly coins: number;
  /** Calidad real del lote (0-1). */
  readonly real: number;
  /** Lo que el comprador creyó al pagar (0-1). */
  readonly believed: number;
  /** Cuánto le creía al vendedor al cerrar el trato (0-1). */
  readonly trust: number;
}

export interface ScamDeals {
  readonly deals: readonly ScamDeal[];
}

/** Los tratos inflados de cada comprador que todavía no descubrió (la verdad; él no los lee). Solo escribe `life.act`. */
export const SCAM_DEALS = table<ScamDeals>("economy.scam_deals");

/** Los tratos que el comprador ya descubrió (por evento del trato), para no descubrirlos dos veces. Solo escribe `life.scam_discovery`. */
export interface ScamFound {
  readonly events: readonly EventId[];
}
export const SCAM_FOUND = table<ScamFound>("economy.scam_found");

/** Cuántos tratos sin descubrir guarda cada comprador (los más viejos se dan por perdidos). */
export const KEPT_SCAM_DEALS = 8;

/** Suma un trato inflado, con tope. Puro. */
export function recordScamDeal(before: ScamDeals | undefined, deal: ScamDeal): ScamDeals {
  return { deals: [...(before?.deals ?? []), deal].slice(-KEPT_SCAM_DEALS) };
}

/** Los tratos que `found` ya descubrió (para que el que escribe `SCAM_DEALS` los suelte al registrar otro). */
export function pendingScams(deals: ScamDeals | undefined, found: ScamFound | undefined) {
  const done = new Set(found?.events ?? []);
  return (deals?.deals ?? []).filter((d) => !done.has(d.event));
}
