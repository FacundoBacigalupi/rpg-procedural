// Lo que comparten el cruce y el saludo del viajero (travel §3, npc-b2b4c2): el libro de a quién se
// cruzó en el viaje (`NPC_MET`), el de a quién ya saludó (`NPC_GREETED`) y cuándo uno no saluda.
// Vive aparte para que `npc-verbs` (el saludo por la decisión, `life-33`) y `npc-greetings` (el
// proceso directo, motores anteriores) lo lean sin importarse entre sí.

import { type Relationship, table } from "../../sim/index.ts";

/** A quién ya se cruzó en este viaje (el viaje se identifica por cuándo empezó). */
export const NPC_MET = table<{ readonly since: number; readonly met: readonly string[] }>(
  "life.npc_met",
);

/** A quién ya saludó en este viaje (el viaje se identifica por cuándo empezó). */
export const NPC_GREETED = table<{ readonly since: number; readonly greeted: readonly string[] }>(
  "life.npc_greeted",
);

/** Chance por hora de que la pareja se salude, si ninguno guarda rencor (sin calibrar). */
export const GREET_CHANCE = 0.7;
/** Si siente esto o más de rencor o miedo, o menos de esto de afecto, no saluda. */
export const GREET_REFUSE = { resentment: 0.5, fear: 0.6, affection: -0.3 } as const;

/** Si quien guarda esta relación con el otro no lo saluda (rencor, miedo o aversión). */
export const refusesGreeting = (r: Relationship): boolean =>
  r.dims.resentment >= GREET_REFUSE.resentment ||
  r.dims.fear >= GREET_REFUSE.fear ||
  r.dims.affection <= GREET_REFUSE.affection;
