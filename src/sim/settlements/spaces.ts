// El grafo de espacios de la aldea desde sus edificios (settlements Â§5, perception Â§3): la plaza y,
// por cada edificio vivo, sus cuartos con la puerta a la plaza. Es dato derivado de la verdad, asÃ­
// que al retomar una vida se rehace de lo guardado. Sin edificios (guardados de antes de
// settlements) cae a la aldea mÃ­nima de `villageSpaces`.

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
import type { MaterialDef } from "./defs.ts";
import { BUILDING } from "./tables.ts";
import { partitionBarrier, wallBarrier } from "./upkeep.ts";

export function settlementSpaces(
  truth: ReadonlyWorldTruth,
  hex: number,
  fallbackHouseholds: readonly HouseholdId[] = [],
  materials?: ReadonlyMap<string, MaterialDef>,
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
    // Con materiales, los tabiques entre cuartos y la pared hacia afuera salen del material
    // (settlements §5): el vano entre cuartos solo queda abierto si el tabique no es de papel, y
    // por la pared del cuarto principal se oye y se ve aunque la puerta esté cerrada.
    const wall = materials ? wallBarrier(b.components, materials) : undefined;
    const inner = wall ? partitionBarrier(wall) : "doorway";
    edges.push(
      ...b.graph.edges.map((e) => (e.barrier === "doorway" ? { ...e, barrier: inner } : e)),
      { a: VILLAGE_SQUARE, b: b.graph.entrance, barrier: b.graph.door },
    );
    const main = b.graph.spaces[0];
    if (wall && main && main.key !== b.graph.entrance) {
      edges.push({ a: VILLAGE_SQUARE, b: main.key, barrier: wall });
    }
  }
  return { spaces, edges };
}

/**
 * El mismo grafo, pero vivo: se rehace solo cuando una puerta cambia de estado o un material de
 * pared cambia (el desgaste traba puertas, `life.upkeep`). Es un objeto de identidad estable con
 * `spaces` y `edges` calculados contra la verdad, así los procesos que lo recibieron al armarse
 * ven siempre el grafo de hoy. Cache por la firma de puertas y paredes.
 */
export function liveSettlementSpaces(
  truth: ReadonlyWorldTruth,
  hex: number,
  fallbackHouseholds: readonly HouseholdId[] = [],
  materials?: ReadonlyMap<string, MaterialDef>,
): SpaceGraph {
  let sig: string | undefined;
  let graph: SpaceGraph | undefined;
  const current = (): SpaceGraph => {
    const parts: string[] = [];
    for (const id of truth.ids(BUILDING).sort(compareStrings)) {
      const b = truth.get(BUILDING, id);
      if (!b || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
      const walls = b.components.find((c) => c.part === "walls");
      parts.push(`${id}:${b.graph.door}:${walls?.materials.map((l) => l.material).join("+")}`);
    }
    const now = parts.join("|");
    if (graph === undefined || sig !== now) {
      graph = settlementSpaces(truth, hex, fallbackHouseholds, materials);
      sig = now;
    }
    return graph;
  };
  return {
    get spaces() {
      return current().spaces;
    },
    get edges() {
      return current().edges;
    },
  };
}
