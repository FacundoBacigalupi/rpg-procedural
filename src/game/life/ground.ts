// Lo tirado en el suelo (body-health §9, señales de ansia por objeto): los lotes sin dueño quedan
// en el ledger a nombre del lugar donde se soltaron (`drop`), el mismo del que `take` sin `from`
// levanta. Este módulo da ese lugar para un hex y arma la vista del suelo de `ViewCues`.

import type { PlaceRef } from "../../core/index.ts";
import {
  type LocalMap,
  PLACE,
  placeAt,
  placeRefOf,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";
import type { ViewCues } from "./cue-local.ts";

/**
 * El lugar que tiene lo soltado en `hex` (puro): el lugar con nombre que cubre el hex (la aldea, el
 * campo, el monte) o, fuera de ellos, la celda. Es el `input.place` de `act`, así que lo que suelta
 * `drop` y lo que levanta `take` caen en la misma cuenta.
 */
export function groundHolder(truth: ReadonlyWorldTruth, map: LocalMap, hex: number): PlaceRef {
  const places = truth.ids(PLACE).flatMap((id) => {
    const place = truth.get(PLACE, id);
    return place ? [{ id, place }] : [];
  });
  return placeRefOf(map, placeAt(places, hex));
}

/**
 * `ViewCues` con el suelo leído del ledger (opt-in `groundCues`): lo que haya a nombre del lugar
 * del hex del personaje se ve; los puestos (`stalls`) de `base` se conservan. El suelo que ya
 * traía `base` gana (un test o quien arma la vida a mano).
 */
export function withGround(
  base: ViewCues | undefined,
  truth: ReadonlyWorldTruth,
  map: LocalMap,
): ViewCues {
  return {
    ...(base?.stalls ? { stalls: base.stalls } : {}),
    ground: base?.ground ?? ((hex) => [groundHolder(truth, map, hex)]),
  };
}
