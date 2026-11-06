// La ley del cultivo (cultivation §1, novel-cult-law): la verdad que el seed genera y nadie conoce
// entera. Por ahora un solo camino, el del qi, con una escalera de umbrales de saturación: cada uno
// tiene la capacidad del recipiente (cuánto entra antes de saturar) y el cuello de botella (la
// dificultad intrínseca del salto). Los otros tipos de umbral (cambio de fase, estructura,
// comprensión, nacimiento del alma), los otros caminos y el techo del mundo llegan después. También
// fija qué tan rara es una raíz espiritual en este mundo (`rootThreshold`) y cuánto se parecen dos
// elementos para contar los dos como raíz (`rootSpread`). Vive en una fila del plano (`plane`) con
// su evento de origen.

import { type EventId, normalQuantile, pow, type Rng } from "../../core/index.ts";
import { table } from "../world/index.ts";

/** Un umbral real de un camino (cultivation §1 `Threshold`): solo saturación por ahora. */
export interface ThresholdLaw {
  readonly id: string;
  readonly index: number;
  readonly kind: "saturation";
  /** Cuánta esencia entra en el recipiente antes de saturar en este tramo (unidades de qi). */
  readonly capacity: number;
  /** Dificultad intrínseca del salto, 0-1: lo que la preparación tiene que vencer. */
  readonly bottleneck: number;
  /** Cuánto ofende al Cielo cruzarlo, 0-1 (heaven-karma): sube con la altura. */
  readonly transgression: number;
}

export interface PathLaw {
  readonly id: "qi";
  readonly vessel: "meridians";
  readonly thresholds: readonly ThresholdLaw[];
}

export interface CultivationLaw {
  /** El sistema elemental del mundo (`content/elements/`) y sus elementos, en orden. */
  readonly elementSystem: string;
  readonly elements: readonly string[];
  readonly paths: readonly PathLaw[];
  /** Desde qué valor del rasgo `spirit_root` (desvíos) hay raíz: arriba de él, pocos. */
  readonly rootThreshold: number;
  /** Cuánto (en desvíos) puede quedar un elemento debajo del más fuerte y contar como raíz. */
  readonly rootSpread: number;
  readonly originEventId: EventId;
}

/** La ley en la verdad, en la fila del plano (`plane:N`). */
export const CULTIVATION_LAW = table<CultivationLaw>("cultivation.law");

/** Cuántos umbrales de saturación puede tener el camino del qi (sin calibrar). */
export const QI_THRESHOLDS = [6, 9] as const;
/** Qué parte de la gente nace con raíz, entre estos extremos (sin calibrar: «muchos sin raíz»). */
export const ROOT_SHARE = [0.05, 0.15] as const;

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const between = (rng: Rng, [a, b]: readonly [number, number]) => a + (b - a) * rng.float();

/**
 * La ley de este seed. `rng` es `fork("cultivation", "law")`: mismo seed, misma ley. Los umbrales
 * se vuelven más caros (la capacidad crece geométricamente) y más duros (el cuello de botella sube
 * con el índice, con ruido): la familia queda reconocible aunque cada mundo tenga su escalera.
 */
export function generateCultivationLaw(
  rng: Rng,
  elementSystem: { readonly id: string; readonly elements: readonly string[] },
  originEventId: EventId,
): CultivationLaw {
  const n = rng.int(QI_THRESHOLDS[0], QI_THRESHOLDS[1]);
  const base = between(rng, [70, 130]);
  const growth = between(rng, [2.5, 4]);
  const thresholds: ThresholdLaw[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    thresholds.push({
      id: `qi.${i + 1}`,
      index: i,
      kind: "saturation",
      capacity: Math.round(base * pow(growth, i)),
      bottleneck: round3(Math.min(0.95, Math.max(0.1, 0.25 + 0.6 * t + rng.normal(0, 0.05)))),
      transgression: round3(t * t),
    });
  }
  const share = between(rng, ROOT_SHARE);
  return {
    elementSystem: elementSystem.id,
    elements: [...elementSystem.elements],
    paths: [{ id: "qi", vessel: "meridians", thresholds }],
    rootThreshold: round3(normalQuantile(1 - share)),
    rootSpread: round3(between(rng, [0.3, 0.8])),
    originEventId,
  };
}
