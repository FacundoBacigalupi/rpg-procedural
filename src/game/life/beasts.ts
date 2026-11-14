// Las bestias que bajaron del monte, vistas por el personaje (novel3-beasts-fight-strike): las que
// están en su hex y al aire libre (adentro no se ven), vivas o muertas; cómo se las nombra
// (provisorio hasta `language`) y el perfil con que pelea cada una, del contenido del linaje.

import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  BEAST,
  BODY_STATE,
  ENTITY,
  type FighterBeast,
  type LineageDef,
  LOCATION,
  type ReadonlyWorldTruth,
  type SpaceGraph,
} from "../../sim/index.ts";

/** Lo que hace falta del mundo para ver (sin importar `world.ts`: `fight.ts` usa este módulo). */
export interface BeastSight {
  readonly truth: ReadonlyWorldTruth;
  readonly player: AgentId;
  readonly spaces: SpaceGraph;
}

/** Cómo se dice cada bestia en castellano: el primero es el rótulo. */
export const BEAST_WORDS: Readonly<Record<string, readonly string[]>> = {
  wolf: ["el lobo", "lobo", "la bestia", "bestia", "loba"],
};

/** Una bestia que el personaje tiene a la vista. */
export interface BeastInSight {
  readonly ref: EntityRef;
  readonly lineage: string;
  readonly dead: boolean;
}

/** Las bestias en el hex del personaje si está afuera: vivas primero, por id. */
export function beastsInSight(w: BeastSight): BeastInSight[] {
  const at = w.truth.get(LOCATION, w.player);
  if (at === undefined) return [];
  if (at.space !== undefined && w.spaces.spaces.find((s) => s.key === at.space)?.indoor !== false) {
    return [];
  }
  const out: BeastInSight[] = [];
  for (const id of [...w.truth.ids(BEAST)].sort() as EntityRef[]) {
    const b = w.truth.get(BEAST, id);
    if (!b || w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const there = w.truth.get(LOCATION, id);
    if (there?.hex !== at.hex || there.space !== undefined) continue;
    const dead = (w.truth.get(BODY_STATE, id)?.death ?? null) !== null;
    out.push({ ref: id, lineage: b.lineage, dead });
  }
  return out.sort((a, b) => Number(a.dead) - Number(b.dead));
}

/** Con qué pelea `who` si es una bestia que bajó y su linaje sabe pelear; si no, `undefined`. */
export function beastFighter(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  lineages: readonly LineageDef[],
): { readonly beast: FighterBeast; readonly skill: number } | undefined {
  const b = truth.get(BEAST, who as unknown as EntityRef);
  const fight = b ? lineages.find((l) => l.id === b.lineage)?.fight : undefined;
  if (!fight) return undefined;
  return { beast: { natural: fight.natural, shy: fight.shy }, skill: fight.skill };
}
