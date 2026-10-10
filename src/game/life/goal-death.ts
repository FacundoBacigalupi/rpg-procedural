// Cerrar los objetivos de un NPC al morir (npc-psychology §7). Se escucha la muerte asentada,
// no se agenda sobre la persona: el scheduler deja de decidir por ella una vez terminada.

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  deleteComponent,
  ENTITY,
  type EventDraft,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
} from "../../sim/index.ts";
import { GOAL_EVENT, NPC_GOALS, type NpcGoals } from "./decide.ts";

export const GOAL_DEATH_CLOSURE_PROCESS = "life.goal_death_closure";
export const BODY_DIED_EVENT = "body.died";

export interface GoalDeathClosureOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Cierra cada meta persistida una sola vez y cita muerte, origen y estado anterior. */
export function goalDeathClosureProcess(o: GoalDeathClosureOptions): ProcessDef {
  return {
    id: GOAL_DEATH_CLOSURE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [NPC_GOALS.name, ENTITY.name, LOCATION.name],
    writes: [NPC_GOALS.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const closed = new Set<AgentId>();
      for (const death of ctx.recent) {
        if (death.kind !== BODY_DIED_EVENT) continue;
        const who = death.actors[0];
        if (!who?.startsWith("agent:")) continue;
        const actor = who as AgentId;
        if (closed.has(actor)) continue;
        const base = ctx.truth.get(ENTITY, actor);
        if (!base || base.endedAt === undefined || base.endEventId !== death.id) continue;
        const goals: NpcGoals["items"] = ctx.truth.get(NPC_GOALS, actor)?.items ?? [];
        if (goals.length === 0) continue;
        closed.add(actor);
        for (const goal of goals) {
          events.push({
            kind: GOAL_EVENT,
            actors: [actor],
            place: o.placeOf(ctx.truth, actor),
            data: {
              goal: goal.id,
              layer: goal.layer,
              what: "ended",
              weight: goal.weight,
              ...(goal.value === undefined ? {} : { value: goal.value }),
              ...(goal.target === undefined ? {} : { target: goal.target }),
            },
            emissions: {},
            causes: [
              { kind: "event" as const, event: death.id },
              ...(goal.originEventId === death.id
                ? []
                : [{ kind: "event" as const, event: goal.originEventId }]),
              { kind: "state" as const, entity: actor, key: "goals" },
            ],
          });
        }
        changes.push(deleteComponent(NPC_GOALS, actor));
      }
      return changes.length > 0 ? { changes, events } : {};
    },
  };
}
