// El pronóstico del viajero antes de salir (npc-b2b3b2c3, weather §7, §11): mira el cielo de hoy,
// proyecta el frío de los días que va a estar en camino con lo que su lugar enseña (`foreseenMinC`,
// sin ver el tiempo de los días que vienen) y de ahí decide si carga la capa. Es una creencia: lo
// que leyó puede no ser lo que viene (lee el termómetro con error), y si la deja y el aire baja, lo
// paga el cuerpo (`life.thermal`). Opt-in (`LifeOptions.npcForecast`, con `npcCloak`): apagado, sale
// siempre con la capa, como antes. Puro.

import { type PlanetClock, Rng, type Seed, type Tick } from "../../core/index.ts";
import { dayOf, foreseenMinC, type LocalMap, outdoorTempC } from "../../sim/index.ts";
import { seasonalClothing } from "./thermal.ts";

/** Cuánto se equivoca al leer la temperatura de hoy, desvío en °C (sin calibrar). */
export const MISREAD_SD_C = 1.5;
/** Cuánto más abrigo (clo) tiene que creer que va a necesitar para cargar la capa (sin calibrar). */
export const CLOAK_MARGIN_CLO = 0.3;

/** Lo que creyó el viajero al salir. */
export interface RoadForecast {
  /** La mínima de aire que cree que va a pasar en el camino. */
  readonly minC: number;
  /** Si decide cargar la capa. */
  readonly cloak: boolean;
}

/** Si, creyendo que el aire va a bajar a `minC`, le conviene la capa estando el aire en `nowC`. */
export function wantsCloak(minC: number, nowC: number): boolean {
  return seasonalClothing(minC).clo > seasonalClothing(nowC).clo + CLOAK_MARGIN_CLO;
}

/** El pronóstico de `who` al salir en `now` para `days` días de camino (determinista por persona y día). */
export function forecastBeforeLeaving(
  map: LocalMap,
  clock: PlanetClock,
  seed: Seed,
  who: string,
  now: Tick,
  days: number,
): RoadForecast {
  const day = dayOf(clock, now + Math.round((map.lonDeg / 360) * clock.day));
  const root = Rng.root(seed);
  const misread = root.fork("forecast", who, day).normal(0, MISREAD_SD_C);
  const minC = foreseenMinC(map.climate, clock, root, day, days, misread);
  return { minC, cloak: wantsCloak(minC, outdoorTempC(map, clock, seed, now)) };
}
