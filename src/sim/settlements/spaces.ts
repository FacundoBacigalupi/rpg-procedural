// El grafo de espacios de la aldea desde sus edificios (settlements §5, perception §3): la plaza y,
// por cada edificio vivo, sus cuartos con la puerta a la plaza. Es dato derivado de la verdad, así
// que al retomar una vida se rehace de lo guardado. Sin edificios (guardados de antes de
// settlements) cae a la aldea mínima de `villageSpaces`.

import { compareStrings, type HouseholdId } from "../../core/index.ts";
import {
  ENTITY,
  type ReadonlyWorldTruth,
  type SpaceEdge,
  type SpaceGraph,
  type SpaceNode,
  VILLAGE_SQUARE,
  villageSpaces,
} from "../world/index.ts";
import { BUILDING } from "./tables.ts";

export function settlementSpaces(
  truth: ReadonlyWorldTruth,
  hex: number,
  fallbackHouseholds: readonly HouseholdId[] = [],
): SpaceGraph {
  const standing = truth
    .ids(BUILDING)
    .filter((id) => truth.get(ENTITY, id)?.endedAt === undefined)
    .sort(compareStrings);
  if (standing.length === 0) return villageSpaces({ hex, households: fallbackHouseholds });

  const [square] = villageSpaces({ hex, households: [] }).spaces as [SpaceNode];
  const spaces: SpaceNode[] = [square];
  const edges: SpaceEdge[] = [];
  for (const id of standing) {
    const b = truth.get(BUILDING, id);
    if (!b) continue;
    spaces.push(...b.graph.spaces);
    edges.push(...b.graph.edges, {
      a: VILLAGE_SQUARE,
      b: b.graph.entrance,
      barrier: b.graph.door,
    });
  }
  return { spaces, edges };
}
