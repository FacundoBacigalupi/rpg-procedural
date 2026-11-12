// Las hierbas espirituales (novel2-pills-herbs, cultivation §6, living-world §8): plantas que solo
// crecen donde el qi de la celda está por encima de lo común; cuanto más denso, más caben en pie. Se
// juntan con `gather` como el forraje del monte, rebrotan despacio y de ellas sale lo que refina el
// alquimista (otro ítem). La regla es pura: cuánto cabe en un lugar y cuánto rebrota en unos días.
// Los números de `content/herbs/`, sin calibrar.

import { contentId, defineContent, exp, z } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { PlaceQi } from "./meditation.ts";

export const HerbDef = z.strictObject({
  id: contentId,
  /** El bien (`GoodDef.id`) que se junta, en gramos. */
  good: contentId,
  /** Desde qué qi (nivel del lugar sobre la media del planeta) crece: por debajo, nada. */
  minRatio: z.number().positive(),
  /** Gramos en pie que caben en un lugar por cada punto de qi por encima de `minRatio`. */
  gramsPerRatio: z.number().positive(),
  /** Tasa de rebrote por día (logístico) cuando lo que hay es poco respecto del techo. */
  regrowth: z.number().positive().max(1),
});
export type HerbDef = z.infer<typeof HerbDef>;
export const HERBS = defineContent("herbs", HerbDef);

/** Lo que hay en pie de cada hierba en un lugar (g) y el último día simulado. */
export interface HerbStand {
  readonly standing: Readonly<Record<string, number>>;
  readonly day: number;
}

export const HERB_STAND = table<HerbStand>("cultivation.herb_stand");

/** El qi del lugar sobre la media del planeta (1 = común). */
export function qiRatio(qi: PlaceQi): number {
  return qi.reference > 0 ? qi.level / qi.reference : 0;
}

/** Cuántos gramos de `herb` caben en pie en un lugar con el qi `qi` (nada por debajo del umbral). */
export function herbCapacity(herb: HerbDef, qi: PlaceQi): number {
  return Math.max(0, qiRatio(qi) - herb.minRatio) * herb.gramsPerRatio;
}

/**
 * Lo que hay en pie tras `days` días: logístico hacia `capacity` con una semilla mínima (donde el qi
 * alcanza nunca se apaga del todo); sin techo, se seca.
 */
export function regrowHerb(
  herb: HerbDef,
  standing: number,
  capacity: number,
  days: number,
): number {
  if (capacity <= 0) return 0;
  const s = Math.max(standing, capacity * 0.01);
  const k = exp(-herb.regrowth * Math.max(0, days));
  return (capacity * s) / (s + (capacity - s) * k);
}
