// Tiempo diario de una celda (weather §1, §4; Fase 1): las normales de planet-gen (media anual,
// amplitud de la estación, lluvia por año, viento dominante) más la fase del año del reloj del
// planeta, más una anomalía de la estación con causa. Sin estado: el día `d` sale de
// `rng.fork("weather", celda, d, ...)`, así que estar o no estar ahí no cambia si llueve (weather
// Principios 5) y se puede pedir cualquier día sin correr los anteriores. Lo que falta (sistemas
// que se mueven, balance de agua) vive en ROADMAP; acá el azar solo elige entre lo que las
// normales permiten: no nieva a 20 °C ni llueve en el desierto más que lo que su año dice.

import {
  atan2,
  cos,
  floorDiv,
  floorMod,
  PI,
  type PlanetClock,
  type Rng,
  sin,
  sqrt,
  type Tick,
} from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";

/** Años buenos y malos con causa (weather §1 `SeasonalAnomaly`); sin él, el año normal. */
export interface Anomaly {
  readonly tempOffsetC: number;
  readonly precipFactor: number;
}

export type PrecipKind = "none" | "rain" | "sleet" | "snow";

export interface DayWeather {
  readonly day: number;
  readonly tempMeanC: number;
  readonly tempMinC: number;
  readonly tempMaxC: number;
  readonly precip: { readonly kind: PrecipKind; readonly mm: number };
  /** Nubosidad 0-1. */
  readonly cloud: number;
  /** Viento medio, m/s, y hacia dónde sopla (este, norte), vector unitario. */
  readonly windMs: number;
  readonly windEast: number;
  readonly windNorth: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// Calibración abierta a la pasada de calibración del Hito 1c (weather §Preguntas abiertas).
/** Días de un bloque de tiempo persistente: una baja se queda unos días. */
export const SPELL_DAYS = 3;
/** Fracción de los días de un bloque lluvioso en que llueve. */
const WET_IN_SPELL = 0.75;
/** Retraso de la temperatura respecto del sol, en años (el mar y el suelo guardan calor). */
const SEASON_LAG = 0.04;
/** Hora del día más cálida. */
export const WARMEST_HOUR = 15;

/** Día del mundo (entero) de un tick. */
export function dayOf(clock: PlanetClock, tick: Tick): number {
  return floorDiv(tick, clock.day);
}

/** Fase del año 0-1 a mitad del día `day`; 0 es el equinoccio de primavera del norte. */
export function yearPhase(clock: PlanetClock, day: number): number {
  return floorMod((day + 0.5) * clock.day, clock.year) / clock.year;
}

/** Seno de la estación: +1 en pleno verano del hemisferio de la celda, -1 en pleno invierno. */
export function seasonWave(clock: PlanetClock, day: number, latDeg: number): number {
  const w = sin(2 * PI * (yearPhase(clock, day) - SEASON_LAG));
  return latDeg >= 0 ? w : -w;
}

/** Ruido suave en el tiempo: valores normales cada `scale` días, interpolados con coseno. */
function smooth(rng: Rng, key: string, day: number, scale: number): number {
  const k = floorDiv(day, scale);
  const t = (day - k * scale) / scale;
  const a = rng.fork(key, k).normal();
  const b = rng.fork(key, k + 1).normal();
  const s = (1 - cos(PI * t)) / 2;
  // La interpolación achica la varianza; este factor la devuelve a ~1 en el medio.
  return (a * (1 - s) + b * s) / sqrt((1 - s) * (1 - s) + s * s);
}

/** Probabilidad de día de lluvia según el año de la celda (lo seco llueve menos días y más fuerte). */
export function wetDayChance(annualPrecipMm: number): number {
  return clamp(0.06 + annualPrecipMm / 2400, 0.03, 0.55);
}

/** El tiempo del día `day` de una celda. `rng` es la raíz del mundo o una rama estable. */
export function dailyWeather(
  n: ClimateNormals,
  clock: PlanetClock,
  day: number,
  rng: Rng,
  anomaly?: Anomaly,
): DayWeather {
  const r = rng.fork("weather", n.cell);
  const yearDays = clock.year / clock.day;

  // Precipitación: bloques de unos días lluviosos o secos, y dentro de ellos días sueltos.
  const p = clamp(wetDayChance(n.annualPrecipMm * (anomaly?.precipFactor ?? 1)), 0, 0.9);
  const block = floorDiv(day, SPELL_DAYS);
  const pBlock = Math.min(1, p / WET_IN_SPELL);
  const wetBlock = r.fork("block", block).float() < pBlock;
  const dayRng = r.fork("day", day);
  const wet = wetBlock && dayRng.float() < p / pBlock;
  const meanWetMm =
    (n.annualPrecipMm * (anomaly?.precipFactor ?? 1)) / yearDays / Math.max(p, 1e-6);
  const mm = wet ? Math.round(dayRng.exponential(1 / Math.max(meanWetMm, 0.05)) * 10) / 10 : 0;

  // Temperatura: estación + anomalía + variación de unos días (más grande lejos del ecuador).
  const wave = seasonWave(clock, day, n.latDeg);
  const spread = 1.2 + 0.05 * Math.abs(n.latDeg);
  const mean = round1(
    n.annualMeanC +
      (anomaly?.tempOffsetC ?? 0) +
      wave * (n.seasonalRangeC / 2) +
      spread * smooth(r, "temp", day, 4),
  );

  // Nubes: lluvia = cubierto; si no, más cubierto donde llueve seguido.
  const cloud = wet
    ? clamp(0.8 + 0.2 * dayRng.float(), 0, 1)
    : clamp(0.1 + 0.9 * p * dayRng.float() + 0.15 * dayRng.float(), 0, 0.85);

  const range = Math.max(2, 14 - 8 * cloud);
  const kind: PrecipKind = mm <= 0 ? "none" : mean <= -1 ? "snow" : mean <= 2 ? "sleet" : "rain";

  // Viento: la dirección dominante con desvío; la fuerza sube con el mal tiempo.
  const base = atan2(n.windNorth, n.windEast);
  const dir = base + dayRng.normal(0, 0.7);
  const gust = dayRng.float();
  const windMs = round1(1.5 + 4 * gust * gust + (wet ? 2 : 0));

  return {
    day,
    tempMeanC: mean,
    tempMinC: Math.round((mean - range / 2) * 10) / 10,
    tempMaxC: Math.round((mean + range / 2) * 10) / 10,
    precip: { kind, mm },
    cloud: Math.round(cloud * 100) / 100,
    windMs,
    windEast: Math.round(cos(dir) * 100) / 100,
    windNorth: Math.round(sin(dir) * 100) / 100,
  };
}

/** Temperatura a una hora local del día (curva suave: más cálido a las 15, más frío a las 3). */
export function tempAt(w: DayWeather, hour: number): number {
  const half = (w.tempMaxC - w.tempMinC) / 2;
  return w.tempMeanC + half * cos(((hour - WARMEST_HOUR) / 24) * 2 * PI);
}

/** Cuánto deja pasar el cielo de la luz del día (1 despejado, ~0,4 con lluvia). */
export function skyClearness(w: DayWeather): number {
  return 1 - 0.5 * w.cloud - (w.precip.mm > 0 ? 0.1 : 0);
}
