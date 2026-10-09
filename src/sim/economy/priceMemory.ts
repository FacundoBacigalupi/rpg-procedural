// Creencias de precio y memoria de precios (economy §4, "los precios salen de creencias"). Cada
// uno guarda, por bien, lo que cree que vale el kilo y cuán firme lo cree; cada trato visto lo
// corre hacia lo observado, y con el tiempo sin ver precios la confianza se afloja. Puro.

import { pow } from "../../core/index.ts";

export interface PriceBelief {
  /** Monedas por kilo que cree que vale. */
  readonly perKg: number;
  /** 0-1: cuánto se fía de ese número; con 1 casi no se mueve por un dato. */
  readonly confidence: number;
  /** Día del mundo de la última observación. */
  readonly lastSeenDay: number;
}

/** Piso y techo de la confianza (nunca certeza total ni ignorancia total). */
const MIN_CONF = 0.05;
const MAX_CONF = 0.95;
/** Cuánto pesa un dato nuevo cuando la confianza es la mínima. */
const MAX_STEP = 0.6;
/** Los datos que parecen mentira (más de este múltiplo del creído) pesan la mitad. */
const SURPRISE_RATIO = 3;
/** Días en que la confianza pierde la mitad de lo que le sobra del piso. */
const FORGET_HALF_LIFE_DAYS = 180;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Una creencia nueva a partir de un solo dato (o de la referencia de contenido). */
export function firstBelief(perKg: number, day: number, confidence = 0.2): PriceBelief {
  return { perKg, confidence: clamp(confidence, MIN_CONF, MAX_CONF), lastSeenDay: day };
}

/** Observar un trato a `seenPerKg`: la creencia se corre hacia lo visto y gana confianza. */
export function observePrice(b: PriceBelief, seenPerKg: number, day: number): PriceBelief {
  if (!(seenPerKg > 0)) return b;
  const ratio = seenPerKg > b.perKg ? seenPerKg / b.perKg : b.perKg / seenPerKg;
  const damp = ratio > SURPRISE_RATIO ? 0.5 : 1;
  const step = MAX_STEP * (1 - b.confidence) * damp + 0.05;
  return {
    perKg: b.perKg + (seenPerKg - b.perKg) * clamp(step, 0, 1),
    confidence: clamp(b.confidence + 0.15 * (1 - b.confidence), MIN_CONF, MAX_CONF),
    lastSeenDay: day,
  };
}

/** Con los días sin ver precios, la confianza vuelve hacia el piso (el número queda, la fe no). */
export function decayBelief(b: PriceBelief, day: number): PriceBelief {
  const days = Math.max(0, day - b.lastSeenDay);
  if (days === 0) return b;
  const keep = pow(0.5, days / FORGET_HALF_LIFE_DAYS);
  return { ...b, confidence: MIN_CONF + (b.confidence - MIN_CONF) * keep };
}

/**
 * La base que usa en `askPerKg`/`bidPerKg`: lo que cree, mezclado con la referencia del contenido
 * en proporción inversa a su confianza (quien casi no sabe se apoya en el precio de arranque).
 */
export function workingBase(b: PriceBelief | undefined, referencePerKg: number): number {
  if (b === undefined) return referencePerKg;
  return b.perKg * b.confidence + referencePerKg * (1 - b.confidence);
}
