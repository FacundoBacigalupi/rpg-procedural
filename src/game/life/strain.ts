// Forzar el ritmo (npc-b2b3b2d4, travel §11, body-health): marchar a paso `fast` con el cuerpo ya
// cansado tuerce una pierna. Opt-in (`LifeOptions.npcStrain`, con `npcPace`). Puro: `life.act` lo
// llama al terminar un tramo de `move` y la herida (un golpe contuso leve, el esguince) la abre
// `injure` como cualquier otra, con causa en el paso. Sin la opción nada cambia.

import type { EventId, Rng, Tick } from "../../core/index.ts";
import type { Blow } from "../../sim/index.ts";

/** Fatiga (0-1) desde la que forzar el paso arriesga una pierna. */
export const STRAIN_AT = 0.6;
/** Esguinces por hora de marcha forzada con la fatiga en el tope; escala con lo pasado de `STRAIN_AT`. */
export const STRAIN_PER_HOUR = 0.05;
/** El esguince es leve: una torcedura, no una fractura. */
export const STRAIN_FORCE = 0.2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Chance de que un tramo de `seconds` a paso forzado con esa fatiga tuerza una pierna. */
export function strainChance(fatigue: number, seconds: number, fast: boolean): number {
  if (!fast || !(seconds > 0) || !Number.isFinite(seconds) || !(fatigue > STRAIN_AT)) return 0;
  const over = (clamp01(fatigue) - STRAIN_AT) / (1 - STRAIN_AT);
  return round(Math.min(1, over * STRAIN_PER_HOUR * (seconds / 3600)));
}

/** El esguince que deja el tramo, o null. Una tirada por tramo; cae en una pierna, cerrado (sin suciedad). */
export function strainBlow(
  fatigue: number,
  seconds: number,
  fast: boolean,
  rng: Rng,
  cause: EventId,
  at: Tick,
): Blow | null {
  if (!rng.chance(strainChance(fatigue, seconds, fast))) return null;
  const zone = rng.pick(["left_leg", "right_leg"] as const);
  return { kind: "blunt", force: STRAIN_FORCE * (0.5 + rng.float()), zone, dirt: 0, cause, at };
}
