// Calzado del viajero (npc-b2b3b2, travel §11, body-health): el calzado se gasta con la marcha, más
// en el monte, y gastado cuesta más caminar. Opt-in (`LifeOptions.npcFootwear`). Puro: la rutina de
// `life.act` lo lee al mover y lo escribe al terminar el tramo; sin la opción nadie lo lleva ni se
// gasta. Sin calzado nuevo no hay cómo reponerlo todavía (queda como ítem).

import { table } from "../../sim/index.ts";

/** Qué tan gastado está el calzado de alguien (0 nuevo, 1 destrozado). */
export interface Footwear {
  readonly wear: number;
}

export const FOOTWEAR = table<Footwear>("life.footwear");

/** Segundos de marcha en llano hasta destrozar el calzado (unas 400 horas, sin calibrar). */
export const FOOTWEAR_LIFE_SECONDS = 400 * 3600;
/** El monte (bosque, raíces, piedra) gasta esta cantidad de veces más que el llano. */
export const ROUGH_WEAR = 1.5;
/** Cuánto más cuesta caminar con el calzado destrozado (el desgaste lo escala). */
export const WORN_EXTRA = 0.4;
/** Desgaste desde el que se considera gastado (para avisar o cambiarlo). */
export const WORN_AT = 0.7;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** El desgaste después de caminar `seconds`; `rough` si fue por monte. */
export function wearAfter(wear: number, seconds: number, rough: boolean): number {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return round(clamp01(wear));
  const used = (seconds / FOOTWEAR_LIFE_SECONDS) * (rough ? ROUGH_WEAR : 1);
  return round(clamp01(wear + used));
}

/** Cuánto más se tarda en caminar con ese desgaste (1 = calzado nuevo). */
export function footwearWalkFactor(wear: number | undefined): number {
  return round(1 + WORN_EXTRA * clamp01(wear ?? 0));
}
