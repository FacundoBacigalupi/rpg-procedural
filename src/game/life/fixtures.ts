// Lo fijo de la aldea a la vista (play-refs-objects-fixtures-look): el pozo de la plaza y el granero
// comunal son entidades de settlements (`WORK`, `BUILDING`) que el personaje sabe dónde están por vivir
// ahí (y el banco de la plaza, fixtures-bench). Estando en su espacio los puede nombrar y mirar
// («miro el pozo»); lo que se ve al mirarlo es su
// estado a grandes rasgos (gastado, descuidado). El fogón del cuarto principal de cada casa
// (use-hearth-warm) se ve encendido o frío y se usa para calentarse. La tina del patio de una casa
// con cueros adentro (livestock-hide-tan-look) se ve remojando o casi curtida; sin tanda no hay tina
// a la vista (todavía no es una cosa propia). Solo lee: no cambia la verdad.

import type { EntityRef } from "../../core/index.ts";
import {
  BUILDING,
  ENTITY,
  HEARTH,
  LOCATION,
  TANNING,
  VILLAGE_SQUARE,
  WORK,
} from "../../sim/index.ts";
import type { LifeWorld } from "./world.ts";

/** Una cosa fija a la vista: qué es (`shape`, la clave de las plantillas) y cómo está. */
export interface FixtureInSight {
  readonly ref: EntityRef;
  readonly shape: "well" | "granary" | "hearth" | "bench" | "vat";
  /**
   * El estado que se nota al mirarlo; sin él, está bien. El fogón: encendido o frío. La tina:
   * remojando, o casi curtida desde `TAN_ALMOST_SHARE` de los días.
   */
  readonly state?: "worn" | "poor" | "lit" | "cold" | "soaking" | "almost";
}

/** Cómo se lo nombra (provisorio hasta `language`). */
export const FIXTURE_WORDS: Readonly<Record<FixtureInSight["shape"], readonly string[]>> = {
  well: ["el pozo", "pozo", "aljibe", "brocal"],
  granary: ["el granero", "granero", "troje"],
  hearth: ["el fogón", "fogón", "lumbre"],
  bench: ["el banco", "banco", "banca", "asiento"],
  vat: ["la tina", "tina", "noque", "cuba", "los cueros"],
};

/** Desde qué parte de los días del curtido se ve casi listo. */
export const TAN_ALMOST_SHARE = 0.8;

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
      if (work === undefined || !work.hexes.includes(here.hex) || !live(id)) continue;
      if (work.kind !== "well" && work.kind !== "bench") continue;
      const state = stateOf(work.condition);
      out.push({ ref: id, shape: work.kind, ...(state ? { state } : {}) });
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
  // El fogón de la casa: va por el id del edificio, como la fila de `HEARTH` que lo enciende.
  for (const id of [...w.truth.ids(BUILDING)].sort()) {
    const b = w.truth.get(BUILDING, id);
    if (b?.household === undefined || b.graph.spaces[0]?.key !== here.space || !live(id)) continue;
    const lit = (w.truth.get(HEARTH, id)?.intensity ?? 0) > 0;
    out.push({ ref: id, shape: "hearth", state: lit ? "lit" : "cold" });
  }
  // La tina con cueros, en el patio de su casa: también va por el id del edificio (la fila de
  // `TANNING`); no choca con el fogón porque están en espacios distintos.
  const outdoor = new Set(w.spaces.spaces.filter((s) => s.indoor === false).map((s) => s.key));
  if (outdoor.has(here.space)) {
    for (const id of [...w.truth.ids(TANNING)].sort()) {
      const batch = w.truth.get(TANNING, id);
      const b = w.truth.get(BUILDING, id);
      if (!batch || !b?.graph.spaces.some((s) => s.key === here.space) || !live(id)) continue;
      const days = w.livestockTan?.find((r) => r.from === batch.from)?.days ?? 0;
      const share = days > 0 ? (w.scheduler.now - batch.startedAt) / (days * w.clock.day) : 0;
      out.push({ ref: id, shape: "vat", state: share >= TAN_ALMOST_SHARE ? "almost" : "soaking" });
    }
  }
  return out;
}
