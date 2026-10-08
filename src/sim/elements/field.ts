// El vector elemental del qi de una celda (elements §2, §6): planet-gen da la esencia por fuente
// geológica sin nombre de elemento, y la ley del mundo dice a qué elemento corresponde cada fuente.
// Lo que una fuente da se reparte en enteros entre los elementos que la reclaman (resto mayor), así
// la suma del vector es exactamente la esencia de la celda.

import { apportion, ESSENCE_SOURCES, type Essence } from "../../worldgen/index.ts";
import type { ElementVector } from "./interact.ts";
import type { ElementSystemDef } from "./system.ts";

/** Lo único que se lee de la esencia del planeta. */
export type CellEssence = Pick<Essence, "byKind">;

export function cellElements(
  essence: CellEssence,
  cell: number,
  law: ElementSystemDef,
): ElementVector {
  const out = new Array<number>(law.elements.length).fill(0);
  ESSENCE_SOURCES.forEach((source, k) => {
    const level = (essence.byKind[k] as Float64Array)[cell] as number;
    if (!(level > 0)) return;
    const claimants: number[] = [];
    law.elements.forEach((e, i) => {
      if (e.geologicalSources.includes(source)) claimants.push(i);
    });
    if (claimants.length === 0)
      throw new RangeError(`la fuente ${source} no llega a ningún elemento`);
    const shares = apportion(
      level,
      claimants.map(() => 1),
    );
    claimants.forEach((i, j) => {
      out[i] = (out[i] as number) + (shares[j] as number);
    });
  });
  return out;
}
