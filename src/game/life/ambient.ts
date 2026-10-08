// La temperatura que siente cada cuerpo (weather §5): afuera la del día; adentro de un edificio, un
// tercio de la diferencia con el confort (paredes, techo y fuego; un hogar sin brasero sigue
// siendo más fresco que el aire libre al mediodía y más tibio de noche).

import type { AgentId, PlanetClock, Seed } from "../../core/index.ts";
import {
  type AmbientTemp,
  LOCATION,
  type LocalMap,
  outdoorTempC,
  type ReadonlyWorldTruth,
  type SpaceGraph,
} from "../../sim/index.ts";

/** Temperatura adentro cuando afuera no pasa de ahí (aprox. el confort de una casa de aldea). */
export const INDOOR_BASE_C = 16;
/** Cuánto de la variación de afuera entra a una casa. */
export const INDOOR_LEAK = 0.35;

/** Lo que lee de `LifeParts` (recortado acá: importar `world.ts` cerraría un ciclo). */
export interface AmbientParts {
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
}

export function ambientOf(parts: AmbientParts) {
  return (truth: ReadonlyWorldTruth, who: AgentId): AmbientTemp => {
    const space = truth.get(LOCATION, who)?.space;
    const node = space === undefined ? undefined : parts.spaces.spaces.find((s) => s.key === space);
    const indoor = node?.indoor ?? false;
    return (at) => {
      const out = outdoorTempC(parts.map, parts.clock, parts.seed, at);
      return indoor ? INDOOR_BASE_C + INDOOR_LEAK * (out - INDOOR_BASE_C) : out;
    };
  };
}
