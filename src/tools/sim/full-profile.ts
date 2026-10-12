// Configuración y acumuladores de medición: no crean una Life ni llaman al LLM.
import type { Event } from "../../core/index.ts";

export interface FullProfileConfig {
  readonly seeds: readonly number[];
  readonly years: number;
  readonly days?: number;
  readonly checkEveryDays: number;
  readonly frequency?: number;
}

/** Observación del tooling; el callback nunca entra al estado ni al setup de replay. */
export interface FullProfileProgress {
  readonly seed: number;
  readonly stage: "creation-start" | "creation-complete" | "checkpoint";
  readonly elapsedMs: number;
  readonly tick?: number;
  readonly worldDays?: number;
  readonly checks?: number;
  readonly problems?: number;
  readonly rssBytes?: number;
}

export function validateFullProfileConfig(config: FullProfileConfig): FullProfileConfig {
  if (config.seeds.length === 0 || config.seeds.some((s) => !Number.isSafeInteger(s) || s < 0))
    throw new RangeError("seeds debe contener enteros no negativos");
  if (!Number.isFinite(config.years) || config.years <= 0)
    throw new RangeError("years debe ser positivo y finito");
  for (const [name, value] of [
    ["days", config.days],
    ["checkEveryDays", config.checkEveryDays],
    ["frequency", config.frequency],
  ] as const)
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new RangeError(`${name} debe ser entero positivo`);
  return config;
}

export interface ProcessMeasurement {
  calls: number;
  effectiveCalls: number;
  changes: number;
  events: number;
}

export function recordProcess(
  counts: Map<string, ProcessMeasurement>,
  id: string,
  changes: number,
  events: number,
): void {
  const count = counts.get(id) ?? { calls: 0, effectiveCalls: 0, changes: 0, events: 0 };
  count.calls++;
  if (changes > 0 || events > 0) count.effectiveCalls++;
  count.changes += changes;
  count.events += events;
  counts.set(id, count);
}

/** Solo eventos posteriores a la creación; no mezcla la prehistoria familiar con la corrida. */
export function profileDemography(events: readonly Event[], from: number) {
  const byKind = new Map<string, number>();
  const deathsByCause = new Map<string, number>();
  for (const event of events) {
    if (event.tick <= from) continue;
    byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);
    if (event.kind === "body.died") {
      const cause = String((event.data as { cause?: unknown }).cause ?? "unknown");
      deathsByCause.set(cause, (deathsByCause.get(cause) ?? 0) + 1);
    }
  }
  return {
    eventsByKind: Object.fromEntries([...byKind].sort(([a], [b]) => a.localeCompare(b))),
    births: byKind.get("family.birth") ?? 0,
    deaths: byKind.get("body.died") ?? 0,
    deathsByCause: Object.fromEntries([...deathsByCause].sort(([a], [b]) => a.localeCompare(b))),
  };
}
