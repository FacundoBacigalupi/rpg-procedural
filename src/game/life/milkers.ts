// Quién puede ordeñar hoy (livestock-milk-hours): el ordeñe de `livestockYieldProcess` cuenta una
// hora por persona del hogar; con esto no cuenta al que está de viaje (`NPC_JOURNEY`) ni al que el
// cuerpo no le da (inconsciente, o con las manos o las piernas que no responden). Con `away`
// (livestock-milk-hours-away) tampoco al que al cambio de día no está en el hex de su casa: el que
// viaja sin `NPC_JOURNEY` (el jugador) no vuelve a la mañana a ordeñar.

import type { AgentId } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  BUILDING,
  capabilitiesOf,
  LOCATION,
  PERSON,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

/** Desde cuánto de manos y de piernas se puede ordeñar. */
export const MILK_MANIPULATION = 0.5;
export const MILK_LOCOMOTION = 0.3;

/** Las tablas que lee `ableToMilk`, para el `reads` del proceso. */
export const MILKER_READS = [NPC_JOURNEY.name, BODY_STATE.name] as const;

/** Las que suma `away`. */
export const MILKER_AWAY_READS = [PERSON.name, LOCATION.name, BUILDING.name] as const;

/**
 * Si está en el hex de una vivienda de su hogar; sin vivienda o sin lugar conocido, cuenta como en
 * casa.
 */
export function atHome(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  const household = truth.get(PERSON, id)?.household;
  const at = truth.get(LOCATION, id)?.hex;
  if (household === undefined || at === undefined) return true;
  const homes = truth
    .ids(BUILDING)
    .map((b) => truth.get(BUILDING, b))
    .filter((b) => b?.household === household);
  return homes.length === 0 || homes.some((b) => b?.hex === at);
}

/** Si la persona está en casa y el cuerpo le da para ordeñar. */
export function ableToMilk(
  plans: readonly BodyPlanDef[],
  options: { readonly away?: boolean } = {},
): (truth: ReadonlyWorldTruth, id: AgentId) => boolean {
  return (truth, id) => {
    if (truth.get(NPC_JOURNEY, id)) return false;
    if (options.away === true && !atHome(truth, id)) return false;
    const body = truth.get(BODY_STATE, id);
    const plan = body ? plans.find((p) => p.id === body.plan) : undefined;
    if (!body || !plan) return true;
    const caps = capabilitiesOf(plan, body);
    return caps.manipulation >= MILK_MANIPULATION && caps.locomotion >= MILK_LOCOMOTION;
  };
}
