// Estafa sobre la calidad percibida (economy §6): el vendedor que conoce la calidad real puede
// ofrecerla mejor de lo que es; el comprador la ve con error según su ojo y paga por lo que cree.
// La mentira deja huella: el lote existe y se descubre al usarlo, al tasarlo o por un tercero.
// Puro: no toca el ledger ni el rng (la tirada la pone quien llama).

import { exp } from "../../core/math/index.ts";
import { perceivedQuality, qualityPriceFactor } from "./quality.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
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
