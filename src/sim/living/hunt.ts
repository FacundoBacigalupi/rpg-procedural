// La caza de la gente contra las poblaciones de la celda (living-world §8): los herbívoros que la red
// trófica deja vivos después de la depredación (los lobos comen primero, como en `trophicStep`) son el
// stock sobre el que la gente cobra con `harvestStock`. Lo cobrado se acumula como deuda fraccionaria y
// sale de a individuos enteros (un ciervo es un ciervo), nunca por debajo de un piso de reproductores;
// de cada uno queda carne por su masa. Puro: sin RNG ni IO.

import { table } from "../world/index.ts";
import type { CellEcology, Lineage } from "./trophic.ts";
import { harvestStock } from "./trophic.ts";

/** Fracción cobrada pendiente por linaje (individuos), entre días; en la entidad de la celda. */
export interface HuntState {
  readonly owed: Readonly<Record<string, number>>;
}

export const HUNT = table<HuntState>("living.hunt");

/** Horas-persona de caza que la aldea dedica por día, repartidas entre los linajes cazables. */
export const HUNT_EFFORT_HOURS = 12;
/** Fracción del stock que una hora-persona alcanza (la caza es más difícil que el forraje). */
export const HUNT_CATCHABILITY = 0.002;
/** Reproductores que la gente no toca (por linaje): por debajo de esto no se caza. */
export const HUNT_BREEDERS = 2;
/** Fracción comestible de un animal (el resto es hueso, piel, vísceras). */
export const EDIBLE_FRACTION = 0.4;

export interface HuntStep {
  /** Individuos que salen, por linaje (enteros). */
  readonly taken: Readonly<Record<string, number>>;
  /** Carne comestible en gramos, entera. */
  readonly grams: number;
  /** Deuda fraccionaria que sigue pendiente. */
  readonly owed: Readonly<Record<string, number>>;
  /** Población de la celda con los individuos ya sacados. */
  readonly next: CellEcology;
  /** Rendimiento por hora-persona de cada linaje (baja con el stock). */
  readonly perHour: Readonly<Record<string, number>>;
}

/** Cobra `days` días de caza de `cell` (ya tras la depredación). `effortScale` multiplica el esfuerzo. */
export function huntStep(
  cell: CellEcology,
  lineages: Readonly<Record<string, Lineage>>,
  owedBefore: Readonly<Record<string, number>>,
  days: number,
  effortScale = 1,
): HuntStep {
  const game = cell.populations
    .filter((p) => lineages[p.lineage]?.kingdom === "herbivore")
    .map((p) => p.lineage)
    .sort();
  const taken: Record<string, number> = {};
  const owed: Record<string, number> = { ...owedBefore };
  const perHour: Record<string, number> = {};
  const left = new Map(cell.populations.map((p) => [p.lineage, p.count] as const));
  let grams = 0;
  const effort = (HUNT_EFFORT_HOURS * Math.max(0, days) * effortScale) / Math.max(1, game.length);
  for (const id of game) {
    const count = left.get(id) ?? 0;
    const h = harvestStock(count, effort, HUNT_CATCHABILITY);
    perHour[id] = h.perHour;
    const debt = (owed[id] ?? 0) + h.caught;
    const whole = Math.max(0, Math.min(Math.floor(debt), Math.floor(count) - HUNT_BREEDERS));
    owed[id] = debt - whole;
    if (whole <= 0) continue;
    taken[id] = whole;
    left.set(id, count - whole);
    grams += Math.round(whole * (lineages[id]?.bodyMass ?? 0) * 1000 * EDIBLE_FRACTION);
  }
  const populations = cell.populations.map((p) => ({
    lineage: p.lineage,
    count: left.get(p.lineage) ?? p.count,
  }));
  return { taken, grams, owed, next: { ...cell, populations }, perHour };
}
