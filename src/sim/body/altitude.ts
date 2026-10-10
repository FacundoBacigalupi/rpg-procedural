// Mal de altura y aclimatación (body-health §7), parte pura: la presión relativa baja el oxígeno
// disponible y con él la resistencia (`endurance`); los días en altura suben la aclimatación
// (0-1) y los días en el llano la bajan, más despacio de lo que subió. Sin IO ni RNG. Constantes
// sin calibrar.

import { table } from "../world/index.ts";
import { relativePressure } from "./thermal.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Aclimatación a la altura (0-1) de una persona, aparte del `Body`: sin fila está sin aclimatar.
 * Solo se guarda mientras es mayor que casi cero.
 */
export interface Acclimatization {
  readonly level: number;
  /** Hasta cuándo está calculado. */
  readonly at: number;
}
export const ACCLIMATIZATION = table<Acclimatization>("body.acclimatization");

/** Presión relativa por encima de la cual no hay efecto (unos 1500 m). */
export const ALTITUDE_SAFE_PRESSURE = 0.84;
/** Presión relativa a la que, sin aclimatar, la resistencia cae al mínimo. */
export const ALTITUDE_FLOOR_PRESSURE = 0.3;
/** Resistencia mínima (fracción) por falta de oxígeno con aclimatación 0. */
const MIN_ENDURANCE = 0.25;
/** Cuánto de la falta de oxígeno compensa la aclimatación completa. */
const ACCLIM_RELIEF = 0.75;
/** Ganancia de aclimatación por día en altura (a presión mínima) y pérdida por día en el llano. */
export const ACCLIM_GAIN_PER_DAY = 0.07;
export const ACCLIM_LOSS_PER_DAY = 0.02;

/** Falta de oxígeno (0-1) a una altitud: 0 sobre `ALTITUDE_SAFE_PRESSURE`, 1 en el piso. */
export function hypoxia(altitudeM: number): number {
  const p = relativePressure(altitudeM);
  return clamp(
    (ALTITUDE_SAFE_PRESSURE - p) / (ALTITUDE_SAFE_PRESSURE - ALTITUDE_FLOOR_PRESSURE),
    0,
    1,
  );
}

/** Multiplicador (0-1] de `endurance` por la altitud y la aclimatación (0-1). */
export function altitudeEnduranceFactor(altitudeM: number, acclimatization: number): number {
  const h = hypoxia(altitudeM) * (1 - ACCLIM_RELIEF * clamp(acclimatization, 0, 1));
  return 1 - (1 - MIN_ENDURANCE) * h;
}

/**
 * Aclimatación tras `days` días a `altitudeM`: sube hacia 1 en proporción a la falta de oxígeno
 * (sin falta no hay estímulo) y a lo que falta por ganar; sin estímulo baja despacio.
 */
export function stepAcclimatization(
  level: number,
  altitudeM: number,
  days: number,
  /** Escala de la ganancia (adaptación por genoma); 1 es la tasa de siempre. */
  rate = 1,
): number {
  const h = hypoxia(altitudeM);
  const l = clamp(level, 0, 1);
  if (h <= 0) return clamp(l - ACCLIM_LOSS_PER_DAY * days, 0, 1);
  // Solo ayuda hasta lo que la altura exige: a media altura no se sube más que eso.
  const target = h;
  if (l >= target) return clamp(l - ACCLIM_LOSS_PER_DAY * 0.25 * days, target, 1);
  return clamp(l + ACCLIM_GAIN_PER_DAY * rate * h * days, 0, target);
}

/** Cuánto pesa cada desvío del valor genético de `constitution` en la tasa de aclimatación. */
const ADAPTATION_PER_SD = 0.15;

/**
 * Escala (0.7-1.3) de la tasa de aclimatación por el valor genético aditivo de `constitution`
 * (en desvíos): quien heredó mejor constitución se aclimata más rápido. Sin genoma, 1.
 */
export function adaptationRate(constitutionAdditive: number | undefined): number {
  return clamp(1 + ADAPTATION_PER_SD * (constitutionAdditive ?? 0), 0.7, 1.3);
}

export type AltitudeSickness = "none" | "mild" | "moderate" | "severe";

/** Etiqueta del mal de altura por la falta de oxígeno que queda sin compensar. */
export function altitudeSickness(altitudeM: number, acclimatization: number): AltitudeSickness {
  const h = hypoxia(altitudeM) * (1 - ACCLIM_RELIEF * clamp(acclimatization, 0, 1));
  if (h >= 0.6) return "severe";
  if (h >= 0.3) return "moderate";
  if (h >= 0.1) return "mild";
  return "none";
}
