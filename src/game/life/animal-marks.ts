// Lo que se le nota a un animal por edad, hambre, cría y preñez (livestock-look-more,
// livestock-look-pregnant): lo usan la vista
// (`animals.ts`) y lo que se puede nombrar al carnear (livestock-slaughter-refs). Solo lee.

import type { Duration, EntityRef, Tick } from "../../core/index.ts";
import {
  ANIMAL_HUNGER,
  LACTATING,
  type LivestockDef,
  PREGNANT,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

/**
 * Lo que se le nota de cerca a un animal al mirarlo (livestock-look-more): cría o viejo por la edad,
 * flaco o consumido por el hambre, si da de mamar y si está preñada (livestock-look-pregnant: la
 * panza, en la segunda mitad de la preñez). Se nota hasta donde se nota el cansancio.
 */
export type AnimalMark = "young" | "old" | "thin" | "starving" | "nursing" | "pregnant";

/** Desde qué hambre (`ANIMAL_HUNGER.level`) se lo ve flaco, y desde cuál consumido. */
export const THIN_LOOK_LEVEL = 0.3;
export const STARVING_LOOK_LEVEL = 0.7;
/** Desde qué parte de la vida de su especie (`lifespanYears`) se lo ve viejo. */
export const OLD_LOOK_SHARE = 0.7;
/** Desde qué parte de la preñez (`PREGNANT`) se le nota la panza. */
export const PREGNANT_LOOK_SHARE = 0.5;

/** Pura: lo que se le nota a un animal, sin la vida entera. */
export function animalMarksOf(
  truth: ReadonlyWorldTruth,
  id: EntityRef,
  bornAt: number,
  def: LivestockDef | undefined,
  now: Tick,
  year: Duration,
): AnimalMark[] {
  const marks: AnimalMark[] = [];
  if (def) {
    const age = (now - bornAt) / year;
    if (age < (def.breeding?.maturityYears ?? 1)) marks.push("young");
    else if (age >= OLD_LOOK_SHARE * def.lifespanYears) marks.push("old");
  }
  const hunger = truth.get(ANIMAL_HUNGER, id)?.level ?? 0;
  if (hunger >= STARVING_LOOK_LEVEL) marks.push("starving");
  else if (hunger >= THIN_LOOK_LEVEL) marks.push("thin");
  if (truth.get(LACTATING, id) !== undefined) marks.push("nursing");
  const p = truth.get(PREGNANT, id);
  if (p && now - p.since >= PREGNANT_LOOK_SHARE * (p.due - p.since)) marks.push("pregnant");
  return marks;
}
