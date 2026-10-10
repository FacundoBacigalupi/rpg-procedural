// Presión lenta de meaning desde un vacío subjetivo (§13). Pura: no agrega estado ni escoge acciones.

import { assertTick, compareStrings, type Duration, isId, type Tick } from "../../core/index.ts";
import type { GoalVacuum, GoalVacuumSource } from "./goal-vacuum.ts";

export interface MeaningPressure {
  /** Déficit provisional de meaning entre 0 y 1. */
  readonly pressure: number;
  /** Meses planetarios transcurridos; fracción continua, no se redondea a lunas. */
  readonly elapsedMonths: number;
  /** Evidencia causal individual, sin sumar pesos ni intensidades duplicadas. */
  readonly sources: readonly GoalVacuumSource[];
}

const EMPTY: MeaningPressure = { pressure: 0, elapsedMonths: 0, sources: [] };
const round = (value: number) => Math.round(value * 1e6) / 1e6;

function validSource(source: GoalVacuumSource, now: Tick): boolean {
  return (
    Number.isSafeInteger(source.at) &&
    source.at <= now &&
    isId("event", source.origin) &&
    isId("event", source.cause) &&
    Number.isFinite(source.weight) &&
    source.weight > 0 &&
    source.weight <= 1
  );
}

/**
 * Convierte el vacío en presión lenta: peso máximo de fuente × avance lineal de meses/rampMonths.
 * Un mes se define como 1/12 del año del planeta. El ramp es obligatorio para que ningún valor
 * calibrado quede activado por defecto. Las referencias y el año deben existir en el mundo.
 */
export function meaningPressureFromVacuum(
  vacuum: GoalVacuum | undefined,
  now: Tick,
  planetYear: Duration,
  rampMonths: number,
): MeaningPressure {
  assertTick(now);
  if (!Number.isSafeInteger(planetYear) || planetYear <= 0) {
    throw new RangeError(`año planetario inválido: ${planetYear}`);
  }
  if (!Number.isSafeInteger(rampMonths) || rampMonths <= 0) {
    throw new RangeError(`duración de rampa inválida: ${rampMonths}`);
  }
  if (!vacuum || !Number.isSafeInteger(vacuum.since) || vacuum.since > now) return EMPTY;

  const sources = vacuum.sources
    .filter((source) => validSource(source, now))
    .sort(
      (a, b) =>
        a.at - b.at ||
        compareStrings(a.goalId, b.goalId) ||
        compareStrings(a.origin, b.origin) ||
        compareStrings(a.cause, b.cause),
    )
    .filter(
      (source, index, all) =>
        index === 0 ||
        source.goalId !== all[index - 1]?.goalId ||
        source.at !== all[index - 1]?.at ||
        source.origin !== all[index - 1]?.origin ||
        source.cause !== all[index - 1]?.cause,
    );
  if (sources.length === 0) return EMPTY;

  const elapsedSeconds = now - vacuum.since;
  if (elapsedSeconds < 0) return EMPTY;
  if (!Number.isSafeInteger(elapsedSeconds)) {
    throw new RangeError(`elapsed de meaning inválido: ${elapsedSeconds}`);
  }
  const elapsedMonths = (elapsedSeconds / planetYear) * 12;
  const strength = Math.max(...sources.map((source) => source.weight));
  const progress = Math.min(1, elapsedMonths / rampMonths);
  return {
    pressure: round(strength * progress),
    elapsedMonths: round(elapsedMonths),
    sources,
  };
}
