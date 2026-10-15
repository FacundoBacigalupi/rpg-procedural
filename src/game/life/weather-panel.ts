// El cielo y el pronóstico propio del jugador en el panel (weather §7, §11, player-loop §9). Es una
// creencia, no un dato del mundo: parte de lo que siente hoy (el aire, con el error con que lee el
// día) y de la estación que conoce por el calendario, y proyecta el frío de las noches que vienen
// con `foreseenMinC`, que NO mira el tiempo de mañana. Como los demás paneles, es un muro con la
// verdad: sale en palabras (bandas), sin grados, sin íconos de pronóstico y sin decir si acertó.
// Las señales populares (refranes con correlación calculada) y la lluvia van aparte (ROADMAP
// `weather-forecast-signs`, `weather-forecast-rain`). Puro: no escribe nada ni gasta tiempo.

import { Rng } from "../../core/index.ts";
import {
  dayOf,
  FORECAST_MEMORY_DAYS,
  foreseenMinC,
  outdoorTempC,
  yearPhase,
} from "../../sim/index.ts";
import { MISREAD_SD_C } from "./forecast.ts";
import type { LifeWorld } from "./world.ts";

/** Cómo se siente el aire, de más frío a más calor. */
export type AirFeel = "bitter" | "cold" | "cool" | "mild" | "warm" | "hot";

/** Cuánto frío cree que va a hacer en la peor noche. */
export type NightCold = "hard_frost" | "frost" | "cold" | "cool" | "mild";

/** Cuánta fe le tiene a lo que cree de ese plazo. */
export type ForecastTrust = "fair" | "weak" | "season_only";

export type SeasonName = "spring" | "summer" | "autumn" | "winter";

export interface WeatherPanel {
  /** La estación que ubica por el calendario. */
  readonly season: SeasonName;
  /** Cómo siente el aire ahora. */
  readonly airNow: AirFeel;
  /** Qué espera de las noches que vienen, por plazo (mañana, dentro de tres días, dentro de una semana). */
  readonly outlook: readonly {
    readonly ahead: "tomorrow" | "three_days" | "week";
    readonly night: NightCold;
    readonly trust: ForecastTrust;
  }[];
}

/** Plazos del pronóstico, en días desde hoy. */
const HORIZONS = [
  ["tomorrow", 1],
  ["three_days", 3],
  ["week", 7],
] as const;

export function airFeel(c: number): AirFeel {
  if (c < -10) return "bitter";
  if (c < 4) return "cold";
  if (c < 14) return "cool";
  if (c < 22) return "mild";
  if (c < 30) return "warm";
  return "hot";
}

export function nightCold(c: number): NightCold {
  if (c < -10) return "hard_frost";
  if (c < 0) return "frost";
  if (c < 8) return "cold";
  if (c < 16) return "cool";
  return "mild";
}

/** La fe en un pronóstico a `ahead` días: la memoria del tiempo dura unos días, de ahí en más es la estación. */
export function trustAt(ahead: number): ForecastTrust {
  if (ahead <= 1) return "fair";
  if (ahead < FORECAST_MEMORY_DAYS) return "weak";
  return "season_only";
}

/** La estación por la fase del año del hemisferio del lugar (0 = equinoccio de primavera del norte). */
export function seasonOf(phase: number, latDeg: number): SeasonName {
  const p = latDeg >= 0 ? phase : (phase + 0.5) % 1;
  if (p < 0.25) return "spring";
  if (p < 0.5) return "summer";
  if (p < 0.75) return "autumn";
  return "winter";
}

export function weatherPanel(w: LifeWorld): WeatherPanel {
  const now = w.scheduler.now;
  const today = dayOf(w.clock, now + Math.round((w.map.lonDeg / 360) * w.clock.day));
  const root = Rng.root(w.seed);
  // Lee el día con el error de siempre (el mismo del viajero NPC), fijo para el personaje y el día.
  const misread = root.fork("forecast", w.player, today).normal(0, MISREAD_SD_C);
  return {
    season: seasonOf(yearPhase(w.clock, today), w.map.climate.latDeg),
    airNow: airFeel(outdoorTempC(w.map, w.clock, w.seed, now)),
    outlook: HORIZONS.map(([ahead, days]) => ({
      ahead,
      night: nightCold(foreseenMinC(w.map.climate, w.clock, root, today, days, misread)),
      trust: trustAt(days),
    })),
  };
}
