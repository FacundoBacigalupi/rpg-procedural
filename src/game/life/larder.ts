// La despensa de arranque (economy §1): lo que cada hogar tiene guardado al empezar es lo que
// necesita para llegar a la próxima cosecha, no un número parejo. Se simula el año que viene con
// lo que el hogar cosecharía (sus brazos en el campo, el factor de cada día) y lo que comería, y se
// guarda lo justo para que la reserva no toque cero, más un margen de granero.

import type { PlanetClock } from "../../core/index.ts";
import { HARVEST_GRAMS_PER_HOUR, SOIL_START } from "../../sim/economy/index.ts";
import { ROUTINE } from "./routine.ts";

/** Gramos de grano que come por día una boca promedio (adultos y chicos; ~2300 kcal). */
export const GRAIN_EATEN_PER_PERSON_DAY_G = 700;
/** Días de comida de más que se guardan por encima de lo justo (el granero no se vacía). */
export const LARDER_MARGIN_DAYS = 30;

/**
 * Gramos que necesita un hogar para no quedarse sin comida en el próximo año, dados los años de
 * sus miembros, el suelo en su punto de asiento y el factor de cosecha de cada día (media 1 sobre
 * el año; `harvestSeason`).
 */
export function larderNeeded(
  ages: readonly number[],
  clock: PlanetClock,
  factorOfDay: (day: number) => number,
  startDay: number,
): number {
  const days = Math.round(clock.year / clock.day);
  const workers = ages.filter((a) => a >= ROUTINE.workAge).length;
  const hoursPerDay = ROUTINE.work[1] - ROUTINE.work[0];
  const eaten = ages.length * GRAIN_EATEN_PER_PERSON_DAY_G;
  let balance = 0;
  let lowest = 0;
  for (let i = 0; i < days; i++) {
    balance +=
      workers * hoursPerDay * HARVEST_GRAMS_PER_HOUR * SOIL_START * factorOfDay(startDay + i) -
      eaten;
    lowest = Math.min(lowest, balance);
  }
  return Math.round(-lowest + ages.length * GRAIN_EATEN_PER_PERSON_DAY_G * LARDER_MARGIN_DAYS);
}
