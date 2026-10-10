// La puerta como obstáculo para quien se mueve (settlements §7): el estado de la puerta vive en el
// edificio (`doorState`); esta lectura dice si el espacio queda detrás de una puerta trabada a la
// plaza. Cerrada sin trabar se abre; abierta es la de siempre (sin estado = abierta).

import type { SpaceKey } from "../../core/index.ts";
import { type ReadonlyWorldTruth, VILLAGE_SQUARE } from "../world/index.ts";
import { BUILDING } from "./tables.ts";

/** Si el espacio es de un edificio cuya puerta a la plaza está trabada (no se sale ni se entra). */
export function behindJammedDoor(truth: ReadonlyWorldTruth, space: SpaceKey | undefined): boolean {
  if (space === undefined || space === VILLAGE_SQUARE) return false;
  return truth.ids(BUILDING).some((id) => {
    const b = truth.get(BUILDING, id);
    return b?.doorState === "jammed" && b.graph.spaces.some((s) => s.key === space);
  });
}
