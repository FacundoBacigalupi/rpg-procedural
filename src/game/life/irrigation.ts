// El riego del campo (weather-forecast-rain-npc-farm, weather §7, economy §1): una hora de campo
// que no cosecha sino que lleva agua al surco. La gente de la aldea ve el suelo (cuánto llovió y
// cuánto regaron ya) y cree si va a llover (`believedRainChance`, la misma creencia del viajero,
// con su error y sus refranes): con el suelo seco, en temporada de crecimiento y sin creer que
// llueva, una parte de la gente de campo riega en vez de cosechar esa hora. Si creyó que llovía y no
// llovió, el campo queda seco; si regó y llovió, el agua se perdió. El riego dura `SOIL_DAYS` como la
// lluvia (el mismo balance del suelo, `irrigationBoost`) y no crea grano: sube el rinde de las horas
// siguientes de todo el campo, y el grano que sale sigue viniendo de la fuente `harvest`. El agua
// del pozo o del arroyo no pasa por el ledger. Opt-in (`LifeOptions.npcFieldWatering`).

import { type PlanetClock, Rng, type Seed } from "../../core/index.ts";
import {
  anomalyOfMap,
  irrigationBoost,
  type LocalMap,
  type ReadonlyWorldTruth,
  recentRainMm,
  SOIL_DAYS,
  SOIL_FULL_MM,
  table,
} from "../../sim/index.ts";
import { believedRainChance, RAIN_HORIZON_DAYS, RAIN_WAIT_CHANCE } from "./forecast.ts";

/** Lo que regó una persona: día y milímetros equivalentes de cada hora de riego reciente. */
export interface Irrigated {
  readonly entries: readonly { readonly day: number; readonly mm: number }[];
}
export const IRRIGATED = table<Irrigated>("life.irrigated");

/** Milímetros de lluvia que equivale una hora de riego (sin calibrar). */
export const IRRIGATION_MM_PER_HOUR = 4;
/** Debajo de estos milímetros (lluvia más riego de los últimos días) el suelo se ve seco (sin calibrar). */
export const DRY_SOIL_MM = SOIL_FULL_MM * 0.6;
/** Qué parte de la gente de campo, en un día de suelo seco, se pone a regar (sin calibrar). */
export const WATER_SHARE = 0.1;

/** Los milímetros de riego que todavía cuentan en el campo el día `day`, de toda la aldea. */
export function fieldIrrigationMm(truth: ReadonlyWorldTruth, day: number): number {
  let mm = 0;
  for (const id of truth.ids(IRRIGATED))
    for (const e of truth.get(IRRIGATED, id)?.entries ?? [])
      if (e.day <= day && day - e.day < SOIL_DAYS) mm += e.mm;
  return mm;
}

/** Lo que mira el riego del campo: el mapa, el reloj y la semilla del mundo. */
export interface IrrigationOptions {
  readonly map: LocalMap;
  readonly clock: PlanetClock;
  readonly seed: Seed;
}

/** El campo del día: la lluvia de la ventana, cacheada por día (la rutina lo pide por hora y por persona). */
export function rainWindow(o: IrrigationOptions): (day: number) => number {
  const root = Rng.root(o.seed);
  const anomalyOf = anomalyOfMap(o.map, o.clock, o.seed);
  const cache = new Map<number, number>();
  return (day) => {
    let mm = cache.get(day);
    if (mm === undefined) {
      mm = recentRainMm(o.map.climate, o.clock, root, day, anomalyOf);
      cache.set(day, mm);
    }
    return mm;
  };
}

/**
 * ¿Riega `who` hoy? Solo a la primera hora de campo: le toca por azar (`WATER_SHARE`), el suelo se ve
 * seco (lluvia y riego de los últimos días) y no cree que vaya a llover en el primer tramo.
 */
export function wantsToWater(
  o: IrrigationOptions,
  who: string,
  day: number,
  soilMm: number,
): { readonly water: boolean; readonly chance?: number } {
  if (soilMm >= DRY_SOIL_MM) return { water: false };
  const root = Rng.root(o.seed);
  if (root.fork("water", who, day).float() >= WATER_SHARE) return { water: false };
  const { chance } = believedRainChance(o.map, o.clock, root, who, day, RAIN_HORIZON_DAYS);
  return { water: chance < RAIN_WAIT_CHANCE, chance };
}

/** El rinde extra del campo el día `day` por el riego vigente (>= 1). */
export function fieldBoost(rainedMm: number, truth: ReadonlyWorldTruth, day: number): number {
  return irrigationBoost(rainedMm, fieldIrrigationMm(truth, day));
}
