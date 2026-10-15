// La siembra del campo (weather-forecast-rain-npc-sow, weather §10, economy §1): el campo tiene una
// ventana de siembra por temporada de crecimiento (desde el primer día sin helada que sigue a los días
// de invierno) y cada quien de campo mira el suelo y lo que cree del cielo para decidir cuándo sembrar:
// con el suelo mojado, o con lluvia creída en el primer tramo (`believedRainChance`), siembra; con el
// suelo seco y sin lluvia creída espera, hasta `SOW_MAX_WAIT_DAYS`, donde siembra igual. Cada día de
// espera pasado `SOW_GRACE_DAYS` le cuesta rinde a la temporada (`sowYield`): quien esperó una lluvia
// que no vino pierde cosecha; quien sembró a ciegas en seco y no llovió no pierde nada acá (el suelo
// seco ya lo castiga el balance de agua). La hora de sembrar reemplaza la de cosechar y no sale del
// ledger (la semilla del ledger de la despensa es el ítem `weather-forecast-rain-npc-sow-seed`). Donde
// no hay invierno no hay ventana y no se siembra. Opt-in (`LifeOptions.npcFieldSowing`).

import { Rng, type Seed } from "../../core/index.ts";
import { type ReadonlyWorldTruth, table } from "../../sim/index.ts";
import { believedRainChance, RAIN_HORIZON_DAYS, RAIN_WAIT_CHANCE } from "./forecast.ts";
import { DRY_SOIL_MM, type IrrigationOptions } from "./irrigation.ts";

/** Lo que sembró una persona: la temporada (su primer día) y el día en que sembró. */
export interface Sown {
  readonly start: number;
  readonly day: number;
}
export const SOWN = table<Sown>("life.sown");

/** Qué parte de la gente de campo, cada día de campo sin sembrar, mira si siembra (sin calibrar). */
export const SOW_SHARE = 0.5;
/** Días de espera tras abrirse la ventana en que sembrar no cuesta rinde (sin calibrar). */
export const SOW_GRACE_DAYS = 5;
/** Rinde de la temporada que se pierde por cada día de siembra tardía (sin calibrar). */
export const SOW_LATE_LOSS = 0.004;
/** Lo mínimo que rinde una siembra tardía (sin calibrar). */
export const SOW_FLOOR = 0.9;
/** A los tantos días de abierta la ventana se siembra igual, sin esperar más (sin calibrar). */
export const SOW_MAX_WAIT_DAYS = 8;
/** Debajo de este rinde del día (1 = el promedio del año) el campo no está en temporada de siembra (sin calibrar). */
export const SOW_MIN_SEASON = 0.75;
/** Cuántos días seguidos bajo el mínimo hacen un invierno que cierra la temporada (sin calibrar). */
export const SOW_WINTER_DAYS = 7;

/** El rinde de la temporada (SOW_FLOOR-1) según los días que pasaron del inicio a la siembra. */
export function sowYield(lateDays: number): number {
  return Math.max(SOW_FLOOR, 1 - SOW_LATE_LOSS * Math.max(0, lateDays - SOW_GRACE_DAYS));
}

/**
 * El primer día de la temporada de crecimiento que contiene `day`, o `undefined` si ese día el campo
 * no da (invierno, helada) o no hay invierno en un año (clima sin ventana). `season` es `harvestSeason`.
 */
export function cropStarts(
  season: (day: number) => number,
  yearDays: number,
  winterDays = SOW_WINTER_DAYS,
): (day: number) => number | undefined {
  const cache = new Map<number, number | null>();
  return (day) => {
    if (season(day) < SOW_MIN_SEASON) return undefined;
    const hit = cache.get(day);
    if (hit !== undefined) return hit ?? undefined;
    // El invierno es una racha de al menos SOW_WINTER_DAYS días bajo el mínimo; un día frío suelto no.
    let start: number | null = null;
    let run = 0;
    for (let d = day - 1; d > day - 2 * yearDays; d--) {
      if (season(d) < SOW_MIN_SEASON) {
        run++;
        continue;
      }
      if (run >= winterDays) {
        start = d + run + 1;
        break;
      }
      run = 0;
    }
    cache.set(day, start);
    return start ?? undefined;
  };
}

/** El día en que la aldea sembró la temporada `start`, o `undefined` si todavía no. */
export function sownDay(truth: ReadonlyWorldTruth, start: number): number | undefined {
  let best: number | undefined;
  for (const id of truth.ids(SOWN)) {
    const s = truth.get(SOWN, id);
    if (s && s.start === start && (best === undefined || s.day < best)) best = s.day;
  }
  return best;
}

/** El rinde de la temporada el día `day`: sembrada, el de su día; sin sembrar, el de la espera hasta hoy. */
export function fieldSowYield(truth: ReadonlyWorldTruth, start: number, day: number): number {
  return sowYield((sownDay(truth, start) ?? day) - start);
}

/**
 * ¿Siembra `who` hoy la temporada `start`? Le toca por azar (`SOW_SHARE`) o ya se pasó de espera, y
 * el suelo está mojado o cree que va a llover pronto; pasados `SOW_MAX_WAIT_DAYS` siembra igual.
 */
export function wantsToSow(
  o: IrrigationOptions,
  who: string,
  day: number,
  start: number,
  soilMm: number,
): { readonly sow: boolean; readonly chance?: number } {
  const root = Rng.root(o.seed as Seed);
  if (day - start >= SOW_MAX_WAIT_DAYS) return { sow: true };
  if (root.fork("sow", who, day).float() >= SOW_SHARE) return { sow: false };
  if (soilMm >= DRY_SOIL_MM) return { sow: true };
  const { chance } = believedRainChance(o.map, o.clock, root, who, day, RAIN_HORIZON_DAYS);
  return { sow: chance >= RAIN_WAIT_CHANCE, chance };
}
