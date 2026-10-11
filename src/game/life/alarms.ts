// Los signos del cuerpo que se notan como graves (player-loop §6): hoja sin dependencias de la
// vida, para que la interrupción del personaje y la de los NPC compartan la misma lista.

import { type Body, type BodyPlanDef, bodySigns } from "../../sim/index.ts";

/** Lo que se nota como grave en el cuerpo ("dolor que nota como grave"). */
export const ALARMING_SIGNS: ReadonlySet<string> = new Set([
  "dizzy",
  "parched",
  "starving",
  "exhausted",
  "feverish",
  "bleeding_heavily",
  "bone_broken",
  "wound_hot",
]);

/** Los signos graves de un cuerpo (puro): lo que `bodySigns` dice y `ALARMING_SIGNS` cuenta como grave. */
export function alarmingSignsOf(
  plan: BodyPlanDef,
  body: Body,
  stages?: Parameters<typeof bodySigns>[3],
): Set<string> {
  const signs = bodySigns(plan, body, false, stages);
  return new Set(
    [...signs.general, ...signs.zones.flatMap((z) => z.signs)].filter((s) => ALARMING_SIGNS.has(s)),
  );
}
