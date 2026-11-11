// La primera ruptura (novel-cult-break, cultivation §6-§7): con el recipiente lleno, el cultivador
// empuja el qi contra el umbral. La probabilidad es monótona en la preparación (saturación, pureza,
// calma, meridianos sanos, fundamento) contra el cuello de botella del umbral, y el azar decide
// dentro de ella. Éxito con calidad (suma al fundamento y abre el tramo siguiente, de más
// capacidad); si no, estancarse (solo se pierde el tiempo) o retroceso (parte del qi se va de vuelta
// a la celda y los meridianos quedan dañados), más probable cuanto peor la preparación. Las
// constantes no están calibradas.

import { exp } from "../../core/index.ts";
import type { Aptitude } from "./talent.ts";

export const BREAKTHROUGH_EVENT = "cultivation.breakthrough";

/** Qué tan empinada es la curva alrededor del cuello de botella. */
const STEEPNESS = 10;
/** La fracción del qi que se pierde en el peor retroceso. */
const BACKLASH_LOSS = 0.4;
/** El daño máximo a los meridianos en un retroceso y su tope acumulado. */
const BACKLASH_DAMAGE = 0.3;
export const MAX_MERIDIAN_DAMAGE = 0.9;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

export interface BreakthroughInput {
  readonly qi: number;
  readonly capacity: number;
  readonly purity: number;
  readonly calm: number;
  readonly meridianDamage: number;
  readonly foundation: number;
}

/**
 * Cuán preparado está, 0-1: la saturación pesa al cuadrado (a medio llenar no alcanza), la pureza,
 * la calma y los meridianos sanos multiplican, la comprensión y el fundamento ayudan un poco.
 */
export function breakPreparation(apt: Aptitude, s: BreakthroughInput): number {
  if (apt.roots.length === 0 || s.capacity <= 0) return 0;
  const saturation = clamp01(s.qi / s.capacity);
  const prep =
    saturation *
    saturation *
    (0.4 + 0.6 * clamp01(s.purity)) *
    clamp01(s.calm) *
    (1 - clamp01(s.meridianDamage)) *
    (0.8 + 0.2 * clamp01(apt.comprehension)) *
    (1 + 0.2 * Math.max(0, s.foundation));
  return round4(clamp01(prep));
}

/** La probabilidad de romper: logística en preparación menos cuello de botella. */
export function breakChance(prep: number, bottleneck: number): number {
  return round4(1 / (1 + exp(-STEEPNESS * (prep - bottleneck))));
}

export type BreakOutcome =
  | { readonly kind: "success"; readonly quality: number }
  | { readonly kind: "stalled" }
  | { readonly kind: "backlash"; readonly lostShare: number; readonly damage: number };

/**
 * El resultado con dos tiradas uniformes `u` (¿rompe?) y `v` (¿retrocede?). La calidad del éxito
 * sube con el margen sobre el cuello de botella; el retroceso es más probable y más duro cuanto
 * más por debajo quedó la preparación.
 */
export function breakOutcome(prep: number, bottleneck: number, u: number, v: number): BreakOutcome {
  if (u < breakChance(prep, bottleneck)) {
    return { kind: "success", quality: round4(clamp01(0.5 + (prep - bottleneck))) };
  }
  const short = clamp01(bottleneck - prep);
  if (v < clamp01(0.15 + 1.5 * short)) {
    return {
      kind: "backlash",
      lostShare: round4(BACKLASH_LOSS * (0.25 + 0.75 * short)),
      damage: round4(BACKLASH_DAMAGE * (0.25 + 0.75 * short)),
    };
  }
  return { kind: "stalled" };
}
