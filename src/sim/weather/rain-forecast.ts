// Pronóstico popular de la lluvia (weather §7, §11; weather-forecast-rain): lo que cree de los
// próximos días quien conoce cuánto llueve en su lugar y vio si llovió hoy. NO mira el tiempo de
// los días que pronostica. El tiempo llueve en bloques de `SPELL_DAYS` días (un bloque mojado o
// seco; dentro del mojado llueve en ~3 de cada 4 días): saber si hoy llovió dice algo de los días
// que le quedan al bloque de hoy y nada de los otros, que valen lo que el año del lugar (la
// frecuencia de días de lluvia). Así el pronóstico acierta mejor que la estación sola mañana (si
// el bloque sigue) y de ahí en adelante es el clima. Puro; ignora la anomalía del año (no la ve).

import { floorDiv, type PlanetClock, pow, type Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import { dailyWeather, SPELL_DAYS, wetDayChance } from "./daily.ts";

/** Fracción de los días de un bloque mojado en que llueve (la misma que usa `dailyWeather`). */
const WET_IN_SPELL = 0.75;

/** Lo que alguien vio hoy: si llovió (cualquier precipitación). */
export function rainedToday(
  n: ClimateNormals,
  clock: PlanetClock,
  rng: Rng,
  today: number,
): boolean {
  return dailyWeather(n, clock, today, rng).precip.mm > 0;
}

/**
 * Qué tan seguro está de que el bloque de hoy es mojado, dado lo que vio hoy. Si llovió, es
 * mojado; si no llovió, un día seco es más probable en un bloque seco (Bayes con el clima).
 */
function wetBlockBelief(p: number, pBlock: number, wetToday: boolean): number {
  if (wetToday) return 1;
  const dryDayInWet = pBlock * (1 - p / pBlock);
  return dryDayInWet / (dryDayInWet + (1 - pBlock));
}

/**
 * La probabilidad que alguien le da a que llueva algún día de los próximos `horizonDays` (desde
 * mañana), parado en el día `today` y sabiendo si llovió hoy (`wetToday`).
 */
export function foreseenRainChance(
  n: ClimateNormals,
  today: number,
  horizonDays: number,
  wetToday: boolean,
): number {
  const p = wetDayChance(n.annualPrecipMm);
  const pBlock = Math.min(1, p / WET_IN_SPELL);
  const r = pBlock > 0 ? p / pBlock : 0; // chance de lluvia de un día dentro de un bloque mojado
  const days = Math.max(1, Math.round(horizonDays));
  const last = today + days;
  const todayBlock = floorDiv(today, SPELL_DAYS);
  let pNone = 1;
  let day = today + 1;
  while (day <= last) {
    const block = floorDiv(day, SPELL_DAYS);
    const end = Math.min(last, (block + 1) * SPELL_DAYS - 1);
    const m = end - day + 1;
    const wet = block === todayBlock ? wetBlockBelief(p, pBlock, wetToday) : pBlock;
    pNone *= wet * pow(1 - r, m) + (1 - wet);
    day = end + 1;
  }
  return Math.round((1 - pNone) * 1000) / 1000;
}

/** Cuántos de los próximos `horizonDays` días siguen en el bloque de hoy (lo que sabe de hoy sirve ahí). */
export function sharedBlockDays(today: number, horizonDays: number): number {
  const lastOfBlock = (floorDiv(today, SPELL_DAYS) + 1) * SPELL_DAYS - 1;
  return Math.max(0, Math.min(Math.round(horizonDays), lastOfBlock - today));
}

/** Si llovió algún día de los próximos `horizonDays` días (desde mañana): la verdad, para medir. */
export function actualRain(
  n: ClimateNormals,
  clock: PlanetClock,
  rng: Rng,
  today: number,
  horizonDays: number,
): boolean {
  for (let k = 1; k <= Math.max(1, Math.round(horizonDays)); k++) {
    if (dailyWeather(n, clock, today + k, rng).precip.mm > 0) return true;
  }
  return false;
}
