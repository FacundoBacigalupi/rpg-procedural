// Señal pura para §13: el vacío nace de un núcleo subjetivamente cumplido, no de necesidades
// inmediatas satisfechas. Conserva las causas y los pesos originales; aún no los suma a meaning.

import { compareStrings, type EventId, isId, type Tick } from "../../core/index.ts";
import type { GoalCompletion } from "./goal-progress.ts";
import type { Goal } from "./goals.ts";

export interface GoalVacuumSource {
  readonly goalId: string;
  readonly at: Tick;
  readonly weight: number;
  readonly origin: EventId;
  readonly cause: EventId;
}

export interface GoalVacuum {
  /** La última finalización válida marca el inicio más reciente del vacío. */
  readonly since: Tick;
  /** Fuentes individuales, sin agregación o calibración de sus pesos. */
  readonly sources: readonly GoalVacuumSource[];
}

/**
 * Deriva vacío solo si no queda un objetivo núcleo activo y hay un núcleo que el agente ya
 * considera cumplido. No consulta verdad ni convierte necesidades continuas en objetivos logrados.
 */
export function goalVacuumFromCompletions(
  activeGoals: readonly Goal[],
  completions: readonly GoalCompletion[],
  now: Tick,
): GoalVacuum | undefined {
  if (activeGoals.some((goal) => goal.layer === "core")) return undefined;
  const sources = completions
    .filter(
      (completion) =>
        completion.goalId === completion.original.id &&
        completion.original.layer === "core" &&
        completion.at <= now &&
        completion.original.since <= now &&
        isId("event", completion.cause) &&
        isId("event", completion.original.originEventId) &&
        Number.isFinite(completion.original.weight) &&
        completion.original.weight > 0,
    )
    .map((completion) => ({
      goalId: completion.goalId,
      at: completion.at,
      weight: completion.original.weight,
      origin: completion.original.originEventId,
      cause: completion.cause,
    }))
    .sort(
      (a, b) =>
        a.at - b.at ||
        compareStrings(a.goalId, b.goalId) ||
        compareStrings(a.origin, b.origin) ||
        compareStrings(a.cause, b.cause),
    );
  if (sources.length === 0) return undefined;
  return { since: sources[sources.length - 1]?.at ?? now, sources };
}
