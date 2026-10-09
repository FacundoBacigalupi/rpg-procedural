// Oscilaciones oceánicas de pocos años (planet-gen §3, weather §1): el acople entre vientos y
// temperatura del mar de una cuenca oscila con un período de 2-7 años. Cada fase cambia la lluvia y
// la temperatura de las costas y del interior conectado: sequía de un lado de la cuenca, lluvias del
// otro. Es la causa de los años buenos y malos (`Anomaly`) que `dailyWeather` ya acepta. Puro: el
// azar solo fija período, fase inicial y fuerza de la cuenca (`rng.fork("planet", "oscillation",
// cuenca)`); el valor de un año sale de la fase, sin correr los años anteriores.

import { floorMod, PI, type PlanetClock, type Rng, sin, type Tick } from "../../core/index.ts";
import { type Anomaly, dayOf } from "./daily.ts";

// Calibración abierta a la pasada de calibración (weather §Preguntas abiertas).
export const MIN_PERIOD_YEARS = 2;
export const MAX_PERIOD_YEARS = 7;
/** °C de anomalía de la estación con la oscilación a pleno y teleconexión 1. */
export const OSC_TEMP_C = 1.2;
/** Fracción de la lluvia anual que mueve la oscilación a pleno y teleconexión 1. */
export const OSC_PRECIP = 0.4;
/** Por debajo de este valor absoluto el año cuenta como neutro. */
export const NEUTRAL_BAND = 0.25;

export interface Oscillation {
  /** Clave estable de la cuenca oceánica. */
  readonly basin: string;
  readonly periodYears: number;
  /** Fase inicial 0-1 (año 0). */
  readonly phase0: number;
  /** Fuerza 0-1 de esta cuenca. */
  readonly amplitude: number;
}

export type OscillationPhase = "warm" | "cool" | "neutral";

/** La causa registrada de un año bueno o malo (planet-gen §3 «cada sequía tiene como causa una fase»). */
export interface OscillationCause {
  readonly basin: string;
  readonly year: number;
  readonly phase: OscillationPhase;
  readonly value: number;
}

/** La oscilación de una cuenca: período, fase y fuerza salen del RNG de la cuenca. */
export function oscillationFor(basin: string, rng: Rng): Oscillation {
  const r = rng.fork("planet", "oscillation", basin);
  return {
    basin,
    periodYears:
      Math.round((MIN_PERIOD_YEARS + r.float() * (MAX_PERIOD_YEARS - MIN_PERIOD_YEARS)) * 10) / 10,
    phase0: r.float(),
    amplitude: Math.round((0.5 + 0.5 * r.float()) * 100) / 100,
  };
}

/** Valor -1..1 de la oscilación en el año `year` (entero: se mide a mitad de año). */
export function oscillationValue(osc: Oscillation, year: number): number {
  const turns = floorMod((year + 0.5) / osc.periodYears + osc.phase0, 1);
  return osc.amplitude * sin(2 * PI * turns);
}

export function oscillationPhase(osc: Oscillation, year: number): OscillationPhase {
  const v = oscillationValue(osc, year);
  return v > NEUTRAL_BAND ? "warm" : v < -NEUTRAL_BAND ? "cool" : "neutral";
}

export function oscillationCause(osc: Oscillation, year: number): OscillationCause {
  return {
    basin: osc.basin,
    year,
    phase: oscillationPhase(osc, year),
    value: Math.round(oscillationValue(osc, year) * 1000) / 1000,
  };
}

/**
 * La anomalía del año en un lugar. `teleconnection` (-1..1) dice cómo lo toca la cuenca: positiva
 * en la costa que se moja con la fase cálida, negativa en la opuesta (ahí la misma fase es sequía).
 */
export function oscillationAnomaly(
  osc: Oscillation,
  year: number,
  teleconnection: number,
): Anomaly {
  const v = oscillationValue(osc, year);
  return {
    tempOffsetC: Math.round(OSC_TEMP_C * v * Math.abs(teleconnection) * 10) / 10,
    precipFactor: Math.max(0.3, 1 + OSC_PRECIP * v * teleconnection),
  };
}

/** La anomalía que corresponde a un día del mundo (el año del reloj en que cae). */
export function anomalyOfDay(
  osc: Oscillation,
  clock: PlanetClock,
  teleconnection: number,
): (day: number) => Anomaly {
  const yearDays = Math.round(clock.year / clock.day);
  return (day) => oscillationAnomaly(osc, Math.floor(day / yearDays), teleconnection);
}

/** El año del mundo de un tick. */
export function yearOfTick(clock: PlanetClock, tick: Tick): number {
  return Math.floor(dayOf(clock, tick) / Math.round(clock.year / clock.day));
}
