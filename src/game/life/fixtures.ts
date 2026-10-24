// Lo fijo de la aldea a la vista (play-refs-objects-fixtures-look): el pozo de la plaza y el granero
// comunal son entidades de settlements (`WORK`, `BUILDING`) que el personaje sabe dónde están por vivir
// ahí. Estando en su espacio los puede nombrar y mirar («miro el pozo»); lo que se ve al mirarlo es su
// estado a grandes rasgos (gastado, descuidado). Solo lee: no cambia la verdad.

import type { EntityRef } from "../../core/index.ts";
import { BUILDING, ENTITY, LOCATION, VILLAGE_SQUARE, WORK } from "../../sim/index.ts";
import type { LifeWorld } from "./world.ts";

/** Una cosa fija a la vista: qué es (`shape`, la clave de las plantillas) y cómo está. */
export interface FixtureInSight {
  readonly ref: EntityRef;
  readonly shape: "well" | "granary";
  /** El estado que se nota al mirarlo; sin él, está bien. */
  readonly state?: "worn" | "poor";
}

/** Cómo se lo nombra (provisorio hasta `language`). */
export const FIXTURE_WORDS: Readonly<Record<FixtureInSight["shape"], readonly string[]>> = {
  well: ["el pozo", "pozo", "aljibe", "brocal"],
  granary: ["el granero", "granero", "troje"],
};

/** De la condición (0-1) a lo que se nota: bien, gastado, descuidado. */
function stateOf(condition: number): FixtureInSight["state"] {
  if (condition >= 0.7) return undefined;
  return condition >= 0.4 ? "worn" : "poor";
}

/** Lo fijo en el espacio donde está el personaje: el pozo en la plaza, el granero adentro. */
export function fixturesInSight(w: LifeWorld): FixtureInSight[] {
  const here = w.truth.get(LOCATION, w.player);
  if (here?.space === undefined) return [];
  const out: FixtureInSight[] = [];
  const live = (id: EntityRef) => w.truth.get(ENTITY, id)?.endedAt === undefined;
  if (here.space === VILLAGE_SQUARE) {
    for (const id of [...w.truth.ids(WORK)].sort()) {
      const work = w.truth.get(WORK, id);
      if (work?.kind !== "well" || !work.hexes.includes(here.hex) || !live(id)) continue;
      const state = stateOf(work.condition);
      out.push({ ref: id, shape: "well", ...(state ? { state } : {}) });
    }
  }
  for (const id of [...w.truth.ids(BUILDING)].sort()) {
    const b = w.truth.get(BUILDING, id);
    if (b?.type !== "granary" || b.graph.spaces[0]?.key !== here.space || !live(id)) continue;
    const condition =
      b.components.length === 0 ? 1 : Math.min(...b.components.map((c) => c.condition));
    const state = stateOf(condition);
    out.push({ ref: id, shape: "granary", ...(state ? { state } : {}) });
  }
  return out;
}
