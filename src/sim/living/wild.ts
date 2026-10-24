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
  /** Con leña (`wildFirewood`): madera muerta caída en el monte de la celda (g). */
  readonly deadwood?: number;
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

// Leña: la madera muerta que cae del monte (ramas, troncos secos) se junta en el suelo y se pudre
// despacio; la gente alcanza por día una fracción con su esfuerzo, como el forraje.

/** Fracción de la producción primaria diaria de la celda que cae como madera muerta a mano. */
export const DEADWOOD_SHARE = 0.01;
/** Fracción de la madera caída que se pudre por día (dura años en el suelo). */
export const DEADWOOD_DECAY = 0.002;
/** Horas-persona de búsqueda de leña que la celda ofrece por día, y fracción del stock que alcanza una. */
export const DEADWOOD_REACH_HOURS = 40;
export const DEADWOOD_CATCHABILITY = 0.002;

/** Madera muerta (g) que cae por día con una productividad primaria de `productivityKg` kg/día. */
export function deadwoodFall(productivityKg: number): number {
  return Math.max(0, productivityKg) * 1000 * DEADWOOD_SHARE;
}

/** Madera caída tras `days` días: entra `fall` por día y se pudre `DEADWOOD_DECAY` (solución exacta). */
export function accrueDeadwood(deadwood: number, fall: number, days: number): number {
  const eq = fall / DEADWOOD_DECAY;
  const k = exp(-DEADWOOD_DECAY * Math.max(0, days));
  return eq + (Math.max(0, deadwood) - eq) * k;
}

/** Lo que la gente alcanza hoy de la madera caída y el rendimiento por hora-persona. */
export function deadwoodReach(deadwood: number): {
  readonly grams: number;
  readonly perHour: number;
} {
  const h = harvestStock(deadwood, DEADWOOD_REACH_HOURS, DEADWOOD_CATCHABILITY);
  return { grams: h.caught, perHour: h.perHour };
}
