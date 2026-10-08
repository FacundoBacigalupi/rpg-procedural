// El tiempo en el lugar del personaje, a un tick (weather §11): lo que los demás sistemas leen sin
// saber de normales ni de días. El RNG sale de la semilla del mundo y de la celda, no del jugador.

import { type PlanetClock, Rng, type Seed, type Tick } from "../../core/index.ts";
import { NIGHT_FLOOR, skyBrightness, skyObserverOf } from "../sky/index.ts";
import { type LocalMap, localHour } from "../world/index.ts";
import {
  type Anomaly,
  type DayWeather,
  dailyWeather,
  dayOf,
  skyClearness,
  tempAt,
} from "./daily.ts";

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
 * Luz afuera (0-1) con el cielo: las nubes y la lluvia le quitan a la parte que dan el sol y la
 * luna (`skyBrightness`); el piso de la noche no cambia.
 */
export function skyLight(map: LocalMap, clock: PlanetClock, seed: Seed, tick: Tick): number {
  const base = skyBrightness(clock, skyObserverOf(map), tick);
  const w = weatherAt(map, clock, seed, tick);
  return NIGHT_FLOOR + (base - NIGHT_FLOOR) * skyClearness(w);
}

// Calibración abierta a la pasada de calibración del Hito 1c (travel §11.1).
/** Cuánto suma cada mm de lluvia al tiempo de marcha (barro, resbalones), hasta `MUD_MAX`. */
const MUD_PER_MM = 0.01;
const MUD_MAX = 0.4;
/** Cuánto suma cada mm de agua caída como nieve (nieve que se acumula), hasta `SNOW_MAX`. */
const SNOW_PER_MM = 0.03;
const SNOW_MAX = 0.8;
/** Viento que frena desde este valor (m/s) y lo que suma. */
const GALE_MS = 10;
const GALE_EXTRA = 0.1;
/** Frío que entorpece la marcha: con máxima bajo esto (°C) suma `COLD_EXTRA`. */
const COLD_MAX_C = -8;
const COLD_EXTRA = 0.1;

/**
 * Cuánto más se tarda en caminar un día respecto de uno seco y templado (1 = igual): lluvia que
 * hace barro, nieve que se acumula, ventarrón y frío (travel §11.1, clima del día).
 */
export function walkingFactor(w: DayWeather): number {
  const { kind, mm } = w.precip;
  const wet =
    kind === "snow"
      ? Math.min(SNOW_MAX, SNOW_PER_MM * mm)
      : kind === "none"
        ? 0
        : Math.min(MUD_MAX, MUD_PER_MM * mm) + (kind === "sleet" ? 0.1 : 0);
  return (
    1 + wet + (w.windMs >= GALE_MS ? GALE_EXTRA : 0) + (w.tempMaxC <= COLD_MAX_C ? COLD_EXTRA : 0)
  );
}
