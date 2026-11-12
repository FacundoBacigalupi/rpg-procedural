// La fuerza del Cielo de un mundo (heaven-karma §1, novel2-trib-heaven): una variable del seed que
// dice cuánto aprieta el Cielo y desde qué ofensa una ruptura llama tribulación. Cielo fuerte:
// umbral bajo (tribulaciones desde los reinos de abajo); Cielo débil: umbral alto (solo arriba).
// Vive en la fila del plano, al lado de la ley del cultivo, con su evento de origen. La atención
// finita por región, el karma y la evolución por era llegan después (heaven-karma §3, Fase 4/7).

import type { EventId, Rng } from "../../core/index.ts";
import { table } from "../world/index.ts";

export interface HeavenLaw {
  /** Cuánto aprieta el Cielo, 0-1: sube la ofensa que tolera hacia abajo y la fuerza de las olas. */
  readonly strength: number;
  /**
   * La ofensa (`transgression` del umbral, 0-1) por encima de la cual una ruptura llama
   * tribulación. Sale de la fuerza: a más fuerza, más bajo.
   */
  readonly threshold: number;
  readonly originEventId: EventId;
}

/** La fuerza del Cielo en la verdad, en la fila del plano (`plane:N`). */
export const HEAVEN_LAW = table<HeavenLaw>("heaven.law");

export const HEAVEN_LAW_EVENT = "heaven.law";

/** Entre qué extremos sale la fuerza del Cielo (sin calibrar). */
export const HEAVEN_STRENGTH = [0.25, 0.85] as const;
/** El umbral con el Cielo más débil y cuánto lo baja la fuerza (sin calibrar). */
export const THRESHOLD_TOP = 0.5;
export const THRESHOLD_DROP = 0.45;

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** El umbral de ofensa para una fuerza dada: monótono decreciente en la fuerza. */
export function heavenThreshold(strength: number): number {
  return round3(THRESHOLD_TOP - THRESHOLD_DROP * strength);
}

/** La fuerza del Cielo de este seed. `rng` es `fork("heaven", "law")`: mismo seed, mismo Cielo. */
export function generateHeavenLaw(rng: Rng, originEventId: EventId): HeavenLaw {
  const [lo, hi] = HEAVEN_STRENGTH;
  const strength = round3(lo + (hi - lo) * rng.float());
  return { strength, threshold: heavenThreshold(strength), originEventId };
}

/** Si cruzar un umbral con esta ofensa llama tribulación: la ofensa supera lo que el Cielo tolera. */
export function tribulationDue(heaven: HeavenLaw, transgression: number): boolean {
  return transgression > heaven.threshold;
}
