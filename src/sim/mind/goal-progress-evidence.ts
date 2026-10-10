// Cumplimiento de metas concretas desde progreso propio (npc-psychology §7, f3d4). Puro. Un valor
// continuo (`pursue` de fondo) no se cierra nunca; una meta concreta que el llamador declara se
// cierra solo con varias evidencias propias, distintas y separadas en el tiempo: una acción aislada
// aporta como máximo `PROGRESS_PER_EVIDENCE_CAP` y no basta.

import { compareStrings, type Duration, type EventId, isId, type Tick } from "../../core/index.ts";
import type { GoalCompletion } from "./goal-progress.ts";
import type { Goal } from "./goals.ts";

/** Lo que el agente vio o hizo y que acerca la meta; el evento es la causa citable. */
export interface GoalProgressEvidence {
  readonly goalId: string;
  readonly cause: EventId;
  readonly at: Tick;
  /** Cuánto cree que avanzó (0-1); se topa por evidencia. */
  readonly amount: number;
}

/** Ninguna evidencia sola aporta más que esto: hacen falta al menos tres. */
export const PROGRESS_PER_EVIDENCE_CAP = 0.34;
/** Progreso acumulado desde el que la meta concreta se da por cumplida. */
export const PROGRESS_COMPLETE_MIN = 1;
/** Evidencias distintas mínimas. */
export const PROGRESS_MIN_EVENTS = 3;

export interface GoalProgress {
  readonly goalId: string;
  readonly progress: number;
  readonly events: number;
  /** Lapso entre la primera y la última evidencia válida. */
  readonly span: Duration;
  readonly last: GoalProgressEvidence | undefined;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Evidencia válida de `goal`: propia, posterior al nacimiento, no futura y con causa; sin repetir causa. */
export function validEvidence(
  goal: Goal,
  evidence: readonly GoalProgressEvidence[],
  now: Tick,
): GoalProgressEvidence[] {
  const seen = new Set<string>();
  return evidence
    .filter(
      (e) =>
        e.goalId === goal.id &&
        Number.isSafeInteger(e.at) &&
        e.at >= goal.since &&
        e.at <= now &&
        isId("event", e.cause) &&
        Number.isFinite(e.amount) &&
        e.amount > 0,
    )
    .sort((a, b) => a.at - b.at || compareStrings(a.cause, b.cause))
    .filter((e) => {
      if (seen.has(e.cause)) return false;
      seen.add(e.cause);
      return true;
    });
}

export function goalProgressOf(
  goal: Goal,
  evidence: readonly GoalProgressEvidence[],
  now: Tick,
): GoalProgress {
  const valid = validEvidence(goal, evidence, now);
  const progress = valid.reduce((s, e) => s + Math.min(PROGRESS_PER_EVIDENCE_CAP, e.amount), 0);
  const first = valid[0];
  const last = valid[valid.length - 1];
  return {
    goalId: goal.id,
    progress: round(Math.min(1, progress)),
    events: valid.length,
    span: first && last ? ((last.at - first.at) as Duration) : (0 as Duration),
    last,
  };
}

/**
 * Cumplimientos desde progreso propio. `concrete` son los ids que el llamador sabe que tienen un
 * final (un valor continuo no se infiere). Exige progreso pleno, `PROGRESS_MIN_EVENTS` causas
 * distintas y un lapso de al menos `minSpan` entre la primera y la última.
 */
export function goalCompletionsFromProgress(
  goals: readonly Goal[],
  evidence: readonly GoalProgressEvidence[],
  now: Tick,
  concrete: ReadonlySet<string>,
  minSpan: Duration,
): GoalCompletion[] {
  const out: GoalCompletion[] = [];
  for (const goal of goals) {
    if (!concrete.has(goal.id) || (goal.layer === "core" && goal.kind === "pursue")) continue;
    const p = goalProgressOf(goal, evidence, now);
    if (!p.last || p.progress < PROGRESS_COMPLETE_MIN) continue;
    if (p.events < PROGRESS_MIN_EVENTS || p.span < minSpan) continue;
    out.push({ goalId: goal.id, cause: p.last.cause, at: p.last.at, original: goal });
  }
  return out;
}
