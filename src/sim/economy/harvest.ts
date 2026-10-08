// La cosecha por estación (economy §1, weather §8): lo que rinde una hora de campo depende de la
// temporada de crecimiento del día (calor, helada) y del agua que dejó la lluvia de los últimos
// días. El factor se normaliza para que el año entero rinda lo mismo que el parejo de antes
// (`HARVEST_GRAMS_PER_HOUR` es el promedio anual): el bioma ya puso cuánta gente sostiene el campo
// (`productivity`), esto solo reparte el año. Sin estado: sale del tiempo del día, que ya es puro.

import type { PlanetClock, Rng } from "../../core/index.ts";
import { type DayWeather, dailyWeather } from "../weather/index.ts";
import type { ClimateNormals } from "../world/index.ts";

// Calibración abierta a la pasada de calibración (ROADMAP Hito 1c).
/** Debajo de esta media diaria (°C) no crece nada; arriba de `GROW_FULL_C`, crece a pleno. */
export const GROW_MIN_C = 4;
export const GROW_FULL_C = 18;
/** Una helada así de fuerte en la mínima del día arruina lo que está en el campo. */
export const FROST_C = -2;
/** Días de lluvia que cuentan para el agua del suelo. */
export const SOIL_DAYS = 10;
/** Milímetros en esos días con los que el suelo no es el límite. */
export const SOIL_FULL_MM = 25;
/** Con el suelo seco rinde esta fracción (el riego y las napas aguantan algo). */
export const DRY_FLOOR = 0.35;
/** Una lluvia así de fuerte (mm en el día) con calor de tormenta puede venir con granizo. */
export const HAIL_MIN_MM = 12;
/** Máxima del día (°C) desde la que la lluvia fuerte es de convección. */
export const HAIL_MIN_MAX_C = 20;
/** Chance de granizo en un día que cumple lo anterior, con la máxima justo en `HAIL_MIN_MAX_C`. */
export const HAIL_CHANCE = 0.2;
/** Con esta máxima (°C) o más el hielo se derrite antes de llegar al suelo: no hay granizo. */
export const HAIL_MELT_C = 32;
/** Fracción del campo que arrasa el día del granizo; después se recupera linealmente. */
export const HAIL_LOSS = 0.6;
/** Días hasta que el campo vuelve a rendir lo de antes. */
export const HAIL_RECOVERY_DAYS = 4;
/** Piso del promedio anual al normalizar, para que un clima sin verano no divida por casi cero. */
const MIN_MEAN = 0.05;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Crecimiento 0-1 de un día por calor y helada. */
export function growthOf(w: DayWeather): number {
  if (w.tempMinC <= FROST_C) return 0;
  const t = clamp((w.tempMeanC - GROW_MIN_C) / (GROW_FULL_C - GROW_MIN_C), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Qué tan mojado está el suelo (`DRY_FLOOR`-1) por la lluvia de los últimos días. */
export function soilWater(recent: readonly DayWeather[]): number {
  const mm = recent.reduce((s, d) => s + (d.precip.kind === "rain" ? d.precip.mm : 0), 0);
  return DRY_FLOOR + (1 - DRY_FLOOR) * clamp(mm / SOIL_FULL_MM, 0, 1);
}

/** ¿Pudo caer granizo ese día? Lluvia fuerte con calor; el azar solo elige entre esos días. */
export function hailPossible(w: DayWeather): boolean {
  return w.precip.kind === "rain" && w.precip.mm >= HAIL_MIN_MM && w.tempMaxC >= HAIL_MIN_MAX_C;
}

/** Chance de granizo de un día posible: baja linealmente hasta cero a `HAIL_MELT_C`. */
export function hailChance(w: DayWeather): number {
  const warm = clamp((HAIL_MELT_C - w.tempMaxC) / (HAIL_MELT_C - HAIL_MIN_MAX_C), 0, 1);
  return HAIL_CHANCE * warm;
}

/** Cuánto del campo sigue en pie (0-1) `ago` días después de un granizo (0 = el mismo día). */
export function hailStanding(ago: number): number {
  return 1 - HAIL_LOSS * Math.max(0, 1 - ago / HAIL_RECOVERY_DAYS);
}

/** Factor crudo de un día (sin normalizar) a partir del tiempo de ese día y de los previos. */
export function rawHarvest(
  day: DayWeather,
  previous: readonly DayWeather[],
  hailAgo?: number,
): number {
  const standing = hailAgo === undefined ? 1 : hailStanding(hailAgo);
  return growthOf(day) * soilWater([day, ...previous]) * standing;
}

/**
 * Cuánto rinde un día respecto del promedio del año (media 1 sobre un año de esa celda). Guarda los
 * días ya pedidos: la rutina lo llama por hora y por persona.
 */
export function harvestSeason(
  n: ClimateNormals,
  clock: PlanetClock,
  rng: Rng,
): (day: number) => number {
  const weather = new Map<number, DayWeather>();
  const at = (d: number): DayWeather => {
    let w = weather.get(d);
    if (!w) {
      w = dailyWeather(n, clock, d, rng);
      weather.set(d, w);
    }
    return w;
  };
  const hails = new Map<number, boolean>();
  const hailed = (d: number): boolean => {
    let h = hails.get(d);
    if (h === undefined) {
      h = hailPossible(at(d)) && rng.fork("hail", n.cell, d).float() < hailChance(at(d));
      hails.set(d, h);
    }
    return h;
  };
  /** Días desde el último granizo que todavía pesa, o nada. */
  const hailAgoAt = (d: number): number | undefined => {
    for (let ago = 0; ago < HAIL_RECOVERY_DAYS; ago++) if (hailed(d - ago)) return ago;
    return undefined;
  };
  const rawAt = (d: number) =>
    rawHarvest(
      at(d),
      Array.from({ length: SOIL_DAYS - 1 }, (_, i) => at(d - 1 - i)),
      hailAgoAt(d),
    );
  const yearDays = Math.round(clock.year / clock.day);
  let sum = 0;
  for (let d = 0; d < yearDays; d++) sum += rawAt(d);
  const mean = Math.max(sum / yearDays, MIN_MEAN);
  const factors = new Map<number, number>();
  return (day) => {
    let f = factors.get(day);
    if (f === undefined) {
      f = rawAt(day) / mean;
      factors.set(day, f);
    }
    return f;
  };
}
