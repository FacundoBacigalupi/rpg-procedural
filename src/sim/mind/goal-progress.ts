// Cumplimiento subjetivo (npc-psychology §7): una venganza termina para quien cree que su blanco
// murió, aunque esa creencia sea falsa. La verdad del blanco no entra; hace falta una fuente evento
// citable para que el cierre futuro pueda conservar su causa.

import { type AgentId, type EventId, isId, type Tick } from "../../core/index.ts";
import { type Beliefs, beliefConfidenceAt, believed } from "../knowledge/index.ts";
import type { Goal } from "./goals.ts";

/** Confianza mínima actual para que creer muerto a alguien cierre subjetivamente una venganza. */
export const GOAL_COMPLETION_MIN_CONFIDENCE = 0.6;

export interface GoalCompletion {
  readonly goalId: string;
  /** Evento citado por la fuente más reciente de la creencia de muerte. */
  readonly cause: EventId;
  /** Momento en que el agente ya considera cumplido el objetivo. */
  readonly at: Tick;
  /** La meta original, incluida su causa de nacimiento. */
  readonly original: Goal;
}

/** Evidencia observada que vincula una creencia de muerte a un evento, por ejemplo un relato. */
export interface GoalDeathEvidence {
  readonly target: AgentId;
  readonly cause: EventId;
}

/**
 * Cumplimiento que el agente puede reconocer desde sus propias creencias. Solo la venganza tiene
 * una condición de término aquí: una creencia de muerte suficientemente firme y con fuente evento.
 * `told` no guarda EventId; el cableado que traduzca rumores a creencias debe pasar `observed` con
 * el evento que hizo creíble ese relato. No se consulta la verdad del blanco.
 */
export function goalCompletionsFromBeliefs(
  goals: readonly Goal[],
  beliefs: Beliefs | undefined,
  now: Tick,
  observed: readonly GoalDeathEvidence[] = [],
): GoalCompletion[] {
  const out: GoalCompletion[] = [];
  for (const goal of goals) {
    if (goal.kind !== "avenge" || goal.target === undefined) continue;
    const death = believed(beliefs, goal.target, "alive");
    if (death?.value !== false) continue;
    if (beliefConfidenceAt(death, now) < GOAL_COMPLETION_MIN_CONFIDENCE) continue;
    const source = death.sources[death.sources.length - 1];
    const cited = source?.kind === "percept" ? source.event : undefined;
    const reported = observed.find((evidence) => evidence.target === goal.target)?.cause;
    const cause = cited ?? reported;
    if (cause === undefined || !isId("event", cause)) continue;
    out.push({ goalId: goal.id, cause, at: now, original: goal });
  }
  return out;
}
