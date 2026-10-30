// Quién puede ordeñar hoy (livestock-milk-hours): el ordeñe de `livestockYieldProcess` cuenta una
// hora por persona del hogar; con esto no cuenta al que está de viaje (`NPC_JOURNEY`) ni al que el
// cuerpo no le da (inconsciente, o con las manos o las piernas que no responden).

import type { AgentId } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  capabilitiesOf,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

/** Desde cuánto de manos y de piernas se puede ordeñar. */
export const MILK_MANIPULATION = 0.5;
export const MILK_LOCOMOTION = 0.3;

/** Las tablas que lee `ableToMilk`, para el `reads` del proceso. */
export const MILKER_READS = [NPC_JOURNEY.name, BODY_STATE.name] as const;

/** Si la persona está en casa y el cuerpo le da para ordeñar. */
export function ableToMilk(
  plans: readonly BodyPlanDef[],
): (truth: ReadonlyWorldTruth, id: AgentId) => boolean {
  return (truth, id) => {
    if (truth.get(NPC_JOURNEY, id)) return false;
    const body = truth.get(BODY_STATE, id);
    const plan = body ? plans.find((p) => p.id === body.plan) : undefined;
    if (!body || !plan) return true;
    const caps = capabilitiesOf(plan, body);
    return caps.manipulation >= MILK_MANIPULATION && caps.locomotion >= MILK_LOCOMOTION;
  };
}
