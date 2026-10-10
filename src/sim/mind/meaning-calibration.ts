// Calibración del vacío de sentido (npc-psychology §13, f3d3c). Pura. Intensidad: la rampa lineal de
// `meaningPressureFromVacuum`; evolución: meseta y luego habituación parcial (nadie queda vacío al
// máximo para siempre, pero tampoco se cura solo); reemplazo: un núcleo nuevo, con causa, apaga la
// presión de forma gradual en vez de cortarla de golpe.

import { assertTick, type EventId, isId, type Tick } from "../../core/index.ts";
import type { GoalVacuum } from "./goal-vacuum.ts";
import { type MeaningPressure, meaningPressureFromVacuum } from "./meaning-pressure.ts";

export interface MeaningCalibration {
  /** Meses hasta saturar la presión. */
  readonly rampMonths: number;
  /** Meses a presión plena después de saturar, antes de habituarse. */
  readonly plateauMonths: number;
  /** Meses que dura la habituación hasta el piso. */
  readonly fadeMonths: number;
  /** Fracción de la presión plena que queda tras habituarse (0-1). */
  readonly floor: number;
  /** Meses que tarda un reemplazo en apagar la presión por completo. */
  readonly reliefMonths: number;
}

/** Valores medidos con `meaning-vacuum` de `tools/sim` (seeds 1..20); ver npc-psychology §13. */
export const MEANING_CALIBRATION: MeaningCalibration = {
  rampMonths: 9,
  plateauMonths: 24,
  fadeMonths: 48,
  floor: 0.4,
  reliefMonths: 4,
};

/** Un núcleo concreto nuevo que ocupa el lugar del cumplido; el evento es la causa citable. */
export interface MeaningReplacement {
  readonly at: Tick;
  readonly cause: EventId;
}

export interface CalibratedMeaning extends MeaningPressure {
  /** Presión antes de habituación y alivio (la rampa cruda). */
  readonly raw: number;
  /** Multiplicador de habituación (1 hasta el fin de la meseta, `floor` al final). */
  readonly habituation: number;
  /** Fracción aliviada por el reemplazo (0 sin reemplazo, 1 apagada). */
  readonly relief: number;
}

function check(c: MeaningCalibration): void {
  const pos = (x: number) => Number.isFinite(x) && x > 0;
  if (!pos(c.rampMonths) || !pos(c.fadeMonths) || !pos(c.reliefMonths)) {
    throw new RangeError("calibración de sentido inválida: duraciones deben ser > 0");
  }
  if (!Number.isFinite(c.plateauMonths) || c.plateauMonths < 0) {
    throw new RangeError("calibración de sentido inválida: meseta < 0");
  }
  if (!Number.isFinite(c.floor) || c.floor < 0 || c.floor > 1) {
    throw new RangeError("calibración de sentido inválida: piso fuera de [0, 1]");
  }
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Multiplicador de habituación según los meses transcurridos desde el cumplimiento. */
export function habituation(elapsedMonths: number, c: MeaningCalibration): number {
  check(c);
  const over = elapsedMonths - c.rampMonths - c.plateauMonths;
  if (over <= 0) return 1;
  return round(1 - (1 - c.floor) * Math.min(1, over / c.fadeMonths));
}

/**
 * Presión de sentido calibrada. Un reemplazo anterior al vacío o sin evento válido no cuenta: la
 * causa del alivio es obligatoria (regla 5). Sin rampa por defecto en la función cruda: se pasa aquí.
 */
export function calibratedMeaningPressure(
  vacuum: GoalVacuum | undefined,
  now: Tick,
  planetYear: number,
  replacement?: MeaningReplacement,
  c: MeaningCalibration = MEANING_CALIBRATION,
): CalibratedMeaning {
  check(c);
  assertTick(now);
  const base = meaningPressureFromVacuum(vacuum, now, planetYear, c.rampMonths);
  if (base.sources.length === 0 || !vacuum) {
    return { ...base, raw: 0, habituation: 1, relief: 0 };
  }
  const hab = habituation(base.elapsedMonths, c);
  let relief = 0;
  if (
    replacement &&
    isId("event", replacement.cause) &&
    Number.isSafeInteger(replacement.at) &&
    replacement.at >= vacuum.since &&
    replacement.at <= now
  ) {
    const months = ((now - replacement.at) / planetYear) * 12;
    relief = round(Math.min(1, months / c.reliefMonths));
  }
  return {
    ...base,
    pressure: round(base.pressure * hab * (1 - relief)),
    raw: base.pressure,
    habituation: hab,
    relief,
  };
}
