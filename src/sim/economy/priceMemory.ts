// Creencias de precio y memoria de precios (economy §4, "los precios salen de creencias"). Cada
// uno guarda, por bien, lo que cree que vale el kilo y cuán firme lo cree; cada trato visto lo
// corre hacia lo observado, y con el tiempo sin ver precios la confianza se afloja. Puro.

import { pow } from "../../core/index.ts";
import { table } from "../world/index.ts";

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

/** Lo que cree de precios cada agente, por unidad del ledger (`good:<id>`). */
export type PriceBeliefs = Readonly<Record<string, PriceBelief>>;

/** Las creencias de precio de cada agente (economy §4): el trato las lee y las corre. */
export const PRICE_BELIEFS = table<PriceBeliefs>("economy.price_beliefs");

/**
 * La base de trato de un bien para quien tiene estas creencias: lo creído (con la fe ya aflojada
 * por los días) mezclado con la referencia del contenido.
 */
export function baseFor(
  beliefs: PriceBeliefs | undefined,
  unit: string,
  referencePerKg: number,
  day: number,
): number {
  const b = beliefs?.[unit];
  return workingBase(b === undefined ? undefined : decayBelief(b, day), referencePerKg);
}

/** Las creencias después de ver un trato a `seenPerKg` (parte de la referencia si no sabía nada). */
export function observeDeal(
  beliefs: PriceBeliefs | undefined,
  unit: string,
  seenPerKg: number,
  referencePerKg: number,
  day: number,
): PriceBeliefs {
  const prev = beliefs?.[unit];
  const start = prev === undefined ? firstBelief(referencePerKg, day) : decayBelief(prev, day);
  return { ...beliefs, [unit]: observePrice(start, seenPerKg, day) };
}
