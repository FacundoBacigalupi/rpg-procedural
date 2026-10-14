// Recados: ir a un lugar de otro hex como decisión (opt-in `errands`). Sin esto, la única decisión
// `move` nace del ansia de una sustancia; con él, los viajes de NPC y el dormir de los lejanos
// pasan también en una aldea sin consumibles.
import type { Candidate } from "../../sim/index.ts";
import { STAKES_RISK } from "../../sim/index.ts";

export interface ErrandOptions {
  /** Tipos de lugar (`PLACE.kind`) que se visitan, p. ej. `fields`, `forest`, `water`. */
  readonly kinds: readonly string[];
  /** Chance (0-1) por decisión de que entre una candidata de recado. */
  readonly chance: number;
  /**
   * Edad mínima (años vividos) para salir de recado: quien es chico no sale solo del hogar (un
   * bebé de 4 kg no emprende un viaje de días). Sin esto, cualquiera.
   */
  readonly minAgeYears?: number;
  /** Ánimo que suma la candidata. */
  readonly weight: number;
}

export interface ErrandPlace {
  readonly id: string;
  readonly kind: string;
  readonly hexes: readonly number[];
}

/**
 * A lo sumo una candidata `move:<lugar>`. `roll` y `pick` (0-1) vienen de un fork del RNG de la
 * decisión; el lugar es el que sigue en orden de id entre los que no contienen `here`.
 */
export function errandCandidates(
  places: readonly ErrandPlace[],
  here: number,
  o: ErrandOptions,
  roll: number,
  pick: number,
): readonly Candidate[] {
  if (roll >= o.chance) return [];
  const far = places
    .filter((p) => o.kinds.includes(p.kind) && !p.hexes.includes(here))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const target = far[Math.min(far.length - 1, Math.floor(pick * far.length))];
  if (!target) return [];
  return [
    {
      id: `move:${target.id}`,
      verb: "move",
      target: target.id,
      contributes: {},
      chance: 0.9,
      loss: STAKES_RISK.none.loss,
      mood: o.weight,
    },
  ];
}
