// Medición del vacío de sentido sobre seeds (f3d3c): cada seed arma venganzas cumplidas con pesos y
// momentos derivados del RNG, deriva el vacío con la función real y mide la presión calibrada en
// puntos fijos. Sirve para fijar `MEANING_CALIBRATION` con evidencia y detectar regresiones.

import { makeId, Rng, type Seed, type Tick } from "../../core/index.ts";
import {
  calibratedMeaningPressure,
  type Goal,
  type GoalCompletion,
  goalVacuumFromCompletions,
  MEANING_CALIBRATION,
  type MeaningCalibration,
  type MeaningReplacement,
} from "../../sim/index.ts";
import { type MetricSummary, summarizeFlat } from "./batch.ts";

/** Segundos de un año de la Tierra: el planeta de pruebas; la medición es relativa al año. */
export const MEASURE_PLANET_YEAR = 365 * 86_400;
/** Meses (desde el cumplimiento) donde se mide. */
export const MEASURE_MONTHS = [1, 3, 9, 18, 33, 60, 96] as const;

export interface VacuumSeedReport {
  readonly seed: Seed;
  readonly sources: number;
  readonly pressureAt: Readonly<Record<string, number>>;
  /** Presión 4 meses después de un reemplazo en el mes 12. */
  readonly afterReplacement: number;
  readonly causalSources: number;
}

const monthTicks = (m: number): number => Math.round((m / 12) * MEASURE_PLANET_YEAR);

export function measureVacuumSeed(
  seed: Seed,
  c: MeaningCalibration = MEANING_CALIBRATION,
): VacuumSeedReport {
  const rng = Rng.root(seed).fork("meaning-vacuum");
  const count = rng.int(1, 3);
  const start = monthTicks(2);
  const completions: GoalCompletion[] = [];
  let event = 1;
  for (let i = 0; i < count; i++) {
    const target = makeId("agent", 100 + i);
    const original: Goal = {
      id: `core:avenge:${target}`,
      layer: "core",
      kind: "avenge",
      target,
      weight: 0.5 + rng.float() * 0.5,
      originEventId: makeId("event", event++),
      since: 0 as Tick,
    };
    // Los cumplimientos caen en una ventana de 0 a 3 meses; la presión cuenta desde el último.
    const at = (start + monthTicks(rng.float() * 3)) as Tick;
    completions.push({ goalId: original.id, cause: makeId("event", event++), at, original });
  }
  const last = Math.max(...completions.map((x) => x.at));
  const pressureAt: Record<string, number> = {};
  let causal = 0;
  for (const m of MEASURE_MONTHS) {
    const now = (last + monthTicks(m)) as Tick;
    const vacuum = goalVacuumFromCompletions([], completions, now);
    const p = calibratedMeaningPressure(vacuum, now, MEASURE_PLANET_YEAR, undefined, c);
    pressureAt[`m${m}`] = p.pressure;
    causal = p.sources.length;
  }
  const rep: MeaningReplacement = {
    at: (last + monthTicks(12)) as Tick,
    cause: makeId("event", event++),
  };
  const now = (rep.at + monthTicks(c.reliefMonths)) as Tick;
  const vacuum = goalVacuumFromCompletions([], completions, now);
  const after = calibratedMeaningPressure(vacuum, now, MEASURE_PLANET_YEAR, rep, c).pressure;
  return { seed, sources: count, pressureAt, afterReplacement: after, causalSources: causal };
}

export interface VacuumBatch {
  readonly reports: readonly VacuumSeedReport[];
  readonly summary: Readonly<Record<string, MetricSummary>>;
}

export function measureVacuum(
  seeds: readonly Seed[],
  c: MeaningCalibration = MEANING_CALIBRATION,
): VacuumBatch {
  const reports = seeds.map((s) => measureVacuumSeed(s, c));
  const flats = reports.map((r) => ({
    sources: r.sources,
    causalSources: r.causalSources,
    afterReplacement: r.afterReplacement,
    ...Object.fromEntries(Object.entries(r.pressureAt).map(([k, v]) => [`pressure.${k}`, v])),
  }));
  return { reports, summary: summarizeFlat(flats) };
}
