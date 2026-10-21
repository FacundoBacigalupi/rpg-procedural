// Lo silvestre que la gente puede recoger (living-world §8, §9): el forraje del monte es un stock en pie
// que rebrota con la productividad de la celda (logístico, con un chorrito de semilla para que no muera
// del todo) y del que la gente alcanza, por día, la fracción que da `harvestStock` con su esfuerzo. Lo que
// se alcanza pasa a la cuenta del lugar (de ahí lo toma el verbo `gather`); el stock en pie baja por ese
// mismo monto, así el rendimiento por esfuerzo cae solo cuando se recolecta de más. Puro: sin RNG ni IO.

import { exp } from "../../core/index.ts";
import { table } from "../world/index.ts";
import { harvestStock } from "./trophic.ts";

/** Stock de forraje en pie de la celda (g) y último día simulado. */
export interface WildStock {
  readonly standing: number;
  readonly day: number;
}

export const WILD = table<WildStock>("living.wild");

/** Fracción de la producción primaria diaria de la celda que es forraje comestible para la gente. */
export const PEOPLE_FORAGE_SHARE = 0.01;
/** Días de producción que caben en pie (techo del stock). */
export const FORAGE_CAP_DAYS = 20;
/** Tasa de rebrote por día cuando el stock es chico respecto del techo. */
export const FORAGE_REGROWTH = 0.08;
/** Horas-persona de esfuerzo de recolección que la celda ofrece por día, y fracción del stock que alcanza una. */
export const FORAGE_REACH_HOURS = 40;
export const FORAGE_CATCHABILITY = 0.01;

/** Techo del stock en pie (g) para una productividad primaria de `productivityKg` kg/día en la celda. */
export function forageCapacity(productivityKg: number): number {
  return Math.max(0, productivityKg) * 1000 * PEOPLE_FORAGE_SHARE * FORAGE_CAP_DAYS;
}

/** Rebrote de `days` días: logístico hacia `capacity` con una semilla mínima (nunca se apaga del todo). */
export function regrowForage(standing: number, capacity: number, days: number): number {
  if (capacity <= 0) return 0;
  const s = Math.max(standing, capacity * 0.002);
  // Solución exacta del logístico: estable aunque el tramo sea largo.
  const k = exp(-FORAGE_REGROWTH * Math.max(0, days));
  return (capacity * s) / (s + (capacity - s) * k);
}

/** Lo que la gente alcanza hoy del stock en pie y el rendimiento por hora-persona (baja con el stock). */
export function forageReach(standing: number): {
  readonly grams: number;
  readonly perHour: number;
} {
  const h = harvestStock(standing, FORAGE_REACH_HOURS, FORAGE_CATCHABILITY);
  return { grams: h.caught, perHour: h.perHour };
}
