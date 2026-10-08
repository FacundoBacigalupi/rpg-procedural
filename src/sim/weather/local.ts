// El tiempo en el lugar del personaje, a un tick (weather §11): lo que los demás sistemas leen sin
// saber de normales ni de días. El RNG sale de la semilla del mundo y de la celda, no del jugador.

import { type PlanetClock, Rng, type Seed, type Tick } from "../../core/index.ts";
import { daylight, type LocalMap, localHour } from "../world/index.ts";
import {
  type Anomaly,
  type DayWeather,
  dailyWeather,
  dayOf,
  skyClearness,
  tempAt,
} from "./daily.ts";

/** Piso de luz de la noche: el mismo que `daylight` (la luna llega con cosmology §2). */
const NIGHT_FLOOR = 0.05;

/** El día de un tick en el lugar (el día cambia a la medianoche local). */
export function weatherAt(
  map: LocalMap,
  clock: PlanetClock,
  seed: Seed,
  tick: Tick,
  anomaly?: Anomaly,
): DayWeather {
  const local = tick + Math.round((map.lonDeg / 360) * clock.day);
  return dailyWeather(map.climate, clock, dayOf(clock, local), Rng.root(seed), anomaly);
}

/** Temperatura afuera a un tick, °C. */
export function outdoorTempC(map: LocalMap, clock: PlanetClock, seed: Seed, tick: Tick): number {
  return tempAt(weatherAt(map, clock, seed, tick), localHour(clock, tick, map.lonDeg));
}

/**
 * Luz del día afuera (0-1) con el cielo: las nubes y la lluvia le quitan a la parte que da el sol,
 * y de noche no cambia nada.
 */
export function skyLight(map: LocalMap, clock: PlanetClock, seed: Seed, tick: Tick): number {
  const base = daylight(localHour(clock, tick, map.lonDeg));
  const w = weatherAt(map, clock, seed, tick);
  return NIGHT_FLOOR + (base - NIGHT_FLOOR) * skyClearness(w);
}
