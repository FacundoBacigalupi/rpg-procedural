// El pronóstico del viajero antes de salir (npc-b2b3b2c3, weather §7, §11): mira el cielo de hoy,
// proyecta el frío de los días que va a estar en camino con lo que su lugar enseña (`foreseenMinC`,
// sin ver el tiempo de los días que vienen) y de ahí decide si carga la capa. Es una creencia: lo
// que leyó puede no ser lo que viene (lee el termómetro con error), y si la deja y el aire baja, lo
// paga el cuerpo (`life.thermal`). Opt-in (`LifeOptions.npcForecast`, con `npcCloak`): apagado, sale
// siempre con la capa, como antes.
//
// La lluvia (weather-forecast-rain-npc, opt-in `npcRainForecast`) es otra creencia del mismo
// viajero: si cree que llovió hoy (lo ve, pero a veces lo recuerda mal), cuánto llueve en su lugar
// (`foreseenRainChance`) y, si es de los que se guían por los refranes, lo que dicen las señales
// que ve hoy según lo que vio cumplirse el último año (`folkRainChance`). Con lluvia creída
// espera un día (hasta dos seguidos) y se lleva la capa. Nunca mira el tiempo de los días que
// pronostica: puede esperar sin que llueva y salir justo antes de un chaparrón. Puro.

import { type PlanetClock, Rng, type Seed, type Tick } from "../../core/index.ts";
import {
  dayOf,
  folkRainChance,
  foreseenMinC,
  foreseenRainChance,
  knownSigns,
  type LocalMap,
  outdoorTempC,
  rainedToday,
  signRecord,
  signsShowing,
} from "../../sim/index.ts";
import { seasonalClothing } from "./thermal.ts";

/** Cuánto se equivoca al leer la temperatura de hoy, desvío en °C (sin calibrar). */
export const MISREAD_SD_C = 1.5;
/** Cuánto más abrigo (clo) tiene que creer que va a necesitar para cargar la capa (sin calibrar). */
export const CLOAK_MARGIN_CLO = 0.3;
/** Chance de recordar mal si hoy llovió (sin calibrar). */
export const RAIN_MISREAD_CHANCE = 0.1;
/** Desde qué chance creída de lluvia espera un día y carga la capa (sin calibrar). */
export const RAIN_WAIT_CHANCE = 0.6;
/** Cuántos días de camino mira para la lluvia: el primer tramo, no todo el viaje (sin calibrar). */
export const RAIN_HORIZON_DAYS = 2;
/** Cuántos días seguidos espera la lluvia antes de salir igual. */
export const MAX_RAIN_WAITS = 2;
/** Qué parte de la gente se guía por los refranes antes que por el clima del lugar (sin calibrar). */
export const FOLK_SHARE = 0.5;
/** Cuántos días de lo ya vivido cuentan para la fe en un refrán. */
export const SIGN_LOOKBACK_DAYS = 360;

/** Lo que creyó el viajero al salir. */
export interface RoadForecast {
  /** La mínima de aire que cree que va a pasar en el camino. */
  readonly minC: number;
  /** Si decide cargar la capa. */
  readonly cloak: boolean;
  /** Con `npcRainForecast`: la chance que le da a que llueva en el primer tramo. */
  readonly rain?: number;
  /** Con `npcRainForecast`: si prefiere esperar a que escampe antes de salir. */
  readonly wait?: boolean;
}

/** Si, creyendo que el aire va a bajar a `minC`, le conviene la capa estando el aire en `nowC`. */
export function wantsCloak(minC: number, nowC: number): boolean {
  return seasonalClothing(minC).clo > seasonalClothing(nowC).clo + CLOAK_MARGIN_CLO;
}

/**
 * La chance de lluvia que cree `who` parado en el día `day` para los próximos `horizon` días: el
 * clima del lugar con lo que vio hoy (a veces mal recordado) o, si se guía por refranes y alguno
 * de los que conoce se ve hoy con experiencia suficiente, lo que ese refrán vale según lo vivido.
 */
export function believedRainChance(
  map: LocalMap,
  clock: PlanetClock,
  root: Rng,
  who: string,
  day: number,
  horizon: number,
): { readonly chance: number; readonly folk: boolean } {
  const saw = rainedToday(map.climate, clock, root, day);
  const wetToday = root.fork("rain-read", who, day).float() < RAIN_MISREAD_CHANCE ? !saw : saw;
  const base = foreseenRainChance(map.climate, day, horizon, wetToday);
  if (root.fork("folk", who).float() >= FOLK_SHARE) return { chance: base, folk: false };
  const lore = new Set(knownSigns(root, map.climate.cell));
  const showing = signsShowing(map.climate, clock, root, who, day).filter((id) => lore.has(id));
  const records = new Map(
    showing.map((id) => [
      id,
      signRecord(id, map.climate, clock, root, who, day - 1, SIGN_LOOKBACK_DAYS),
    ]),
  );
  const folk = folkRainChance(showing, records);
  return folk === undefined ? { chance: base, folk: false } : { chance: folk, folk: true };
}

/** El pronóstico de `who` al salir en `now` para `days` días de camino (determinista por persona y día). */
export function forecastBeforeLeaving(
  map: LocalMap,
  clock: PlanetClock,
  seed: Seed,
  who: string,
  now: Tick,
  days: number,
  withRain = false,
): RoadForecast {
  const day = dayOf(clock, now + Math.round((map.lonDeg / 360) * clock.day));
  const root = Rng.root(seed);
  const misread = root.fork("forecast", who, day).normal(0, MISREAD_SD_C);
  const minC = foreseenMinC(map.climate, clock, root, day, days, misread);
  const cloak = wantsCloak(minC, outdoorTempC(map, clock, seed, now));
  if (!withRain) return { minC, cloak };
  const { chance } = believedRainChance(
    map,
    clock,
    root,
    who,
    day,
    Math.min(days, RAIN_HORIZON_DAYS),
  );
  const wet = chance >= RAIN_WAIT_CHANCE;
  return { minC, cloak: cloak || wet, rain: chance, wait: wet };
}
