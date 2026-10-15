// Pronóstico popular del frío (weather §7, §11; npc-b2b3b2c3): lo que cree de los próximos días
// quien conoce el clima de su lugar y mira el cielo de hoy. NO mira el tiempo de mañana: usa lo
// que el saber del lugar permite, la estación esperada (las normales y la fase del año) más cuánto
// se apartó hoy de ella, y esa desviación se desvanece con los días (el tiempo guarda memoria de
// unos días: `smooth` de `dailyWeather`). Así acierta de verdad sin ver el futuro: mañana mejor
// que dentro de una semana, y de una semana adelante solo queda la estación. Quien lee mal el
// termómetro (`misreadC`) arrastra ese error a todo su pronóstico: es una creencia que puede
// separarse de la verdad. Puro. El pronóstico de lluvia y el panel del jugador van aparte (ROADMAP).

import type { PlanetClock, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import { dailyWeather, seasonWave } from "./daily.ts";

/** Días hasta que lo que se vio hoy ya no dice nada del día (`smooth` usa bloques de 4 días). */
export const FORECAST_MEMORY_DAYS = 4;
/** Cuánto baja la mínima del día respecto de la media (la amplitud típica del día, la mitad de ~8 °C). */
export const TYPICAL_HALF_RANGE_C = 4;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** La media de temperatura esperada para el día `day` sin saber nada del tiempo (estación pura). */
export function expectedMeanC(n: ClimateNormals, clock: PlanetClock, day: number): number {
  return n.annualMeanC + seasonWave(clock, day, n.latDeg) * (n.seasonalRangeC / 2);
}

/** Cuánto de la desviación de hoy sigue valiendo `ahead` días después (1 hoy, 0 desde la memoria). */
export function persistence(ahead: number): number {
  return Math.max(0, 1 - ahead / FORECAST_MEMORY_DAYS);
}

/**
 * La mínima de aire que alguien espera en los próximos `horizonDays` días (desde mañana), parado
 * en el día `today`: vio la media de hoy (con su error de lectura `misreadC`), sabe cuál es la
 * normal de la estación y proyecta. Devuelve la peor noche que cree que viene.
 */
export function foreseenMinC(
  n: ClimateNormals,
  clock: PlanetClock,
  rng: Rng,
  today: number,
  horizonDays: number,
  misreadC = 0,
): number {
  const seen = dailyWeather(n, clock, today, rng).tempMeanC + misreadC;
  const dev = seen - expectedMeanC(n, clock, today);
  let min = Number.POSITIVE_INFINITY;
  for (let k = 1; k <= Math.max(1, Math.round(horizonDays)); k++) {
    const mean = expectedMeanC(n, clock, today + k) + persistence(k) * dev;
    min = Math.min(min, mean - TYPICAL_HALF_RANGE_C);
  }
  return round1(min);
}

/** La mínima de aire que de verdad hubo en los próximos `horizonDays` días (desde mañana). */
export function actualMinC(
  n: ClimateNormals,
  clock: PlanetClock,
  rng: Rng,
  today: number,
  horizonDays: number,
): number {
  let min = Number.POSITIVE_INFINITY;
  for (let k = 1; k <= Math.max(1, Math.round(horizonDays)); k++) {
    min = Math.min(min, dailyWeather(n, clock, today + k, rng).tempMinC);
  }
  return min;
}
