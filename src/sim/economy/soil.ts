// El suelo del campo (planet-gen §9, economy §1): cada cosecha se lleva nutrientes y el rendimiento
// baja; el descanso (el invierno, un año flaco, menos brazos) los devuelve de a poco. Es estado de
// la aldea, no de la hora: un solo número de fertilidad que el proceso diario mueve contra lo que
// salió del campo. Lo demás del suelo (textura, sal, erosión, abono) llega con la tecnología.

import { pow } from "../../core/index.ts";
import { type ReadonlyWorldTruth, table } from "../world/index.ts";

export interface SoilState {
  /** Fertilidad 0-1: multiplica lo que rinde una hora de campo. */
  readonly fertility: number;
  /** Gramos cosechados ya contados (el acumulado de la fuente del ledger al último día). */
  readonly seen: number;
}

/** El suelo de los campos de la aldea, en la entidad de la aldea. */
export const SOIL = table<SoilState>("economy.soil");

// Calibración abierta a la pasada de calibración (ROADMAP Hito 1c).
/** Fracción de lo que falta que el suelo recupera por día de descanso (constante de tiempo ~100 días). */
export const SOIL_RECOVERY = 0.01;
/** Fertilidad que se lleva un día de cosecha plena (todos los brazos, rendimiento medio). */
export const SOIL_DEPLETION = 0.0008;
/** Debajo de esto el suelo ya no baja más (queda la parte que no se cosecha). */
export const SOIL_FLOOR = 0.3;
/** Con la cosecha de siempre el suelo se asienta acá: lo que se pierde es lo que se recupera. */
export const SOIL_START = 1 - SOIL_DEPLETION / SOIL_RECOVERY;

/**
 * Un tramo de `days` días: `harvested` gramos salieron del campo, y `fullDayGrams` es lo que daría
 * un día con todos los brazos y rendimiento medio. Devuelve la fertilidad nueva (sin tocar `seen`).
 */
export function soilAfter(
  fertility: number,
  harvested: number,
  fullDayGrams: number,
  days: number,
): number {
  if (days <= 0) return fertility;
  const load = fullDayGrams > 0 ? Math.max(0, harvested) / (fullDayGrams * days) : 0;
  const settle = Math.max(0, 1 - (SOIL_DEPLETION * load) / SOIL_RECOVERY);
  const next = settle + (fertility - settle) * pow(1 - SOIL_RECOVERY, days);
  return Math.min(1, Math.max(SOIL_FLOOR, next));
}

/** La fertilidad de los campos de la aldea; 1 si todavía no hay suelo anotado. */
export function fieldFertility(truth: ReadonlyWorldTruth): number {
  const [id] = truth.ids(SOIL);
  return (id === undefined ? undefined : truth.get(SOIL, id))?.fertility ?? 1;
}
