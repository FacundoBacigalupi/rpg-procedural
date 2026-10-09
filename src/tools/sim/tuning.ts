// Suite de calibración (tooling §7): evalúa los objetivos de `content/tuning/` sobre lotes de
// seeds. Cada objetivo traduce una sensación a una métrica con tolerancia; los que comparten
// escenario, seeds y años comparten el lote. Es lenta: se corre a mano (`npm run sim:tune`).

import type { Content, Seed } from "../../core/index.ts";
import { defaultGameSetup, type LifeSetup } from "../../game/index.ts";
import { TUNING_TARGETS, type TuningTargetEntry } from "../../sim/index.ts";
import { type MetricSummary, parseSeeds, runBatch } from "./batch.ts";
import { findScenario, scenarioRun } from "./scenario.ts";
import { runSim, type SimOptions, type SimReport } from "./sim.ts";

export interface TargetResult {
  readonly id: string;
  readonly feel: string;
  readonly metric: string;
  /** El valor medido; `undefined` si la métrica no apareció en ninguna corrida. */
  readonly value: number | undefined;
  readonly expect: { readonly min?: number | undefined; readonly max?: number | undefined };
  readonly ok: boolean;
  /** Por qué falla, en una línea. */
  readonly reason?: string;
}

function statOf(summary: Readonly<Record<string, MetricSummary>>, key: string, stat: string) {
  const s = summary[key];
  if (!s || s.present === 0) return undefined;
  return stat === "min" ? s.min : stat === "max" ? s.max : s.mean;
}

/** Mide un objetivo contra el resumen de su lote. `value = stat(metric) / stat(per)` con `per`. */
export function evaluateTarget(
  t: TuningTargetEntry,
  summary: Readonly<Record<string, MetricSummary>>,
): TargetResult {
  const base = { id: t.id, feel: t.feel, metric: t.metric, expect: t.expect };
  let value = statOf(summary, t.metric, t.stat);
  if (value !== undefined && t.per !== undefined) {
    const d = statOf(summary, t.per, t.stat);
    value = d === undefined || d === 0 ? undefined : value / d;
  }
  if (value === undefined) {
    return { ...base, value, ok: false, reason: "la métrica no apareció (o el divisor es 0)" };
  }
  const { min, max } = t.expect;
  if (min !== undefined && value < min) {
    return { ...base, value, ok: false, reason: `${value} < mínimo ${min}` };
  }
  if (max !== undefined && value > max) {
    return { ...base, value, ok: false, reason: `${value} > máximo ${max}` };
  }
  return { ...base, value, ok: true };
}

/** Los objetivos que comparten escenario, seeds y años, en orden de aparición. */
export function groupTargets(
  targets: readonly TuningTargetEntry[],
): readonly (readonly TuningTargetEntry[])[] {
  const groups = new Map<string, TuningTargetEntry[]>();
  for (const t of targets) {
    const key = JSON.stringify([t.scenario ?? null, t.seeds, t.years]);
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.values()];
}

export interface TuningReport {
  readonly results: readonly TargetResult[];
  readonly ok: boolean;
}

/** Corre los objetivos (todos, o los de `only`) y los mide. `run` se inyecta para probar sin sim. */
export function runTuning(
  content: Content,
  base: { readonly frequency?: number; readonly checkEveryDays?: number },
  only?: readonly string[],
  run: (o: SimOptions) => SimReport = runSim,
): TuningReport {
  const all = content.all(TUNING_TARGETS);
  const wanted = only === undefined ? all : all.filter((t) => only.includes(t.id));
  if (only !== undefined) {
    const missing = only.filter((id) => !all.some((t) => t.id === id));
    if (missing.length > 0) throw new Error(`objetivo desconocido: ${missing.join(", ")}`);
  }
  const results: TargetResult[] = [];
  for (const group of groupTargets(wanted)) {
    const first = group[0] as TuningTargetEntry;
    const seeds: readonly Seed[] = parseSeeds(first.seeds);
    const setup: LifeSetup = first.scenario
      ? scenarioRun(findScenario(content, first.scenario), base.frequency).setup
      : {
          game: defaultGameSetup("realistic"),
          ...(base.frequency === undefined ? {} : { frequency: base.frequency }),
        };
    const batch = runBatch(
      seeds,
      {
        content,
        years: first.years,
        setup,
        ...(base.checkEveryDays === undefined ? {} : { checkEveryDays: base.checkEveryDays }),
      },
      run,
    );
    for (const t of group) results.push(evaluateTarget(t, batch.summary));
  }
  return { results, ok: results.every((r) => r.ok) };
}

/** Una línea por objetivo, para la terminal. */
export function formatTuning(report: TuningReport): string {
  const lines = report.results.map(
    (r) => `${r.ok ? "ok  " : "FALLA"} ${r.id}: ${r.feel}${r.ok ? "" : ` (${r.reason ?? ""})`}`,
  );
  lines.push(report.ok ? "todos los objetivos se cumplen" : "hay objetivos sin cumplir");
  return lines.join("\n");
}
