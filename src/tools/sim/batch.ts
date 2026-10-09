// Lotes de seeds (tooling §6, `sim:batch`): corre la sim headless sobre varios seeds y resume cada
// métrica (media, mínimo y máximo). El resumen se compara con `diffMetrics` (A/B con las mismas seeds).

import type { Seed } from "../../core/index.ts";
import { type FlatMetrics, flattenMetrics } from "./diff.ts";
import { runSim, type SimOptions, type SimReport } from "./sim.ts";

/** `"7"`, `"1..100"` o `"1,5,9..11"` -> lista de seeds sin repetir, en orden. */
export function parseSeeds(spec: string): readonly Seed[] {
  const out: Seed[] = [];
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:\.\.\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new Error(`seeds inválidos: ${spec}`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to < from || to - from > 100_000) throw new Error(`rango inválido: ${part}`);
    for (let s = from; s <= to; s++) if (!out.includes(s)) out.push(s);
  }
  return out;
}

export interface MetricSummary {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  /** Cuántas corridas tenían la métrica (una ausente cuenta 0 en la media). */
  readonly present: number;
}

/** Resume cada métrica sobre las corridas; las que faltan en alguna cuentan 0. */
export function summarizeReports(
  reports: readonly SimReport[],
): Readonly<Record<string, MetricSummary>> {
  const flats = reports.map(flattenMetrics);
  const keys = [...new Set(flats.flatMap((f) => Object.keys(f)))].sort();
  const out: Record<string, MetricSummary> = {};
  for (const key of keys) {
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let present = 0;
    for (const f of flats) {
      const v = f[key] ?? 0;
      if (key in f) present++;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[key] = { mean: sum / flats.length, min, max, present };
  }
  return out;
}

/** Las medias del resumen como métricas planas, para `diffMetrics`. */
export function meansOf(summary: Readonly<Record<string, MetricSummary>>): FlatMetrics {
  return Object.fromEntries(Object.entries(summary).map(([k, s]) => [k, s.mean]));
}

export interface BatchResult {
  readonly seeds: readonly Seed[];
  readonly summary: Readonly<Record<string, MetricSummary>>;
  /** Seeds cuya corrida se detuvo por un invariante violado. */
  readonly stopped: readonly Seed[];
  readonly reports: readonly SimReport[];
}

export function runBatch(
  seeds: readonly Seed[],
  options: Omit<SimOptions, "seed">,
  run: (o: SimOptions) => SimReport = runSim,
): BatchResult {
  if (seeds.length === 0) throw new Error("lote sin seeds");
  const reports = seeds.map((seed) => run({ ...options, seed }));
  return {
    seeds,
    summary: summarizeReports(reports),
    stopped: reports.filter((r) => r.stoppedEarly).map((r) => r.seed),
    reports,
  };
}
