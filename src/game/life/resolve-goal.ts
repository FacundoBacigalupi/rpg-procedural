// Proponerse algo (novel-goals-truth-act, player-loop §8): «quiero vengar a mi madre» se juega como
// el acto `resolve`, que deja las palabras y la persona en el evento; este proceso lo vuelve un
// objetivo de capa `long` en `NPC_GOALS` del que se lo propuso, con ese evento de origen (regla 5),
// así el replay lo reproduce desde el plan y la crónica sabe de dónde salió. Con el modo `drop` lo
// deja. Qué meta es lo decide el catálogo de bosquejos (`content/goals/`), igual que en la sesión:
// lo que no nombra ninguno no se vuelve objetivo.

import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  type EventDraft,
  type Goal,
  PERSON,
  type ProcessDef,
  type StateChange,
  setComponent,
  type ValueId,
} from "../../sim/index.ts";
import type { GoalSketch } from "../view/index.ts";
import { GOAL_EVENT, NPC_GOALS } from "./decide.ts";
import { sketchOf } from "./goals.ts";

export const RESOLVE_GOAL_PROCESS = "life.goals.player";

/** Cuánto pesa un objetivo propuesto (sin calibrar): como uno largo nacido de un esquema fuerte. */
export const RESOLVED_GOAL_WEIGHT = 0.5;

/** Lo que dejó un `action.resolve` (resolve): las palabras, la persona y si es para dejarlo. */
export function resolvedGoal(
  e: Event,
): { who: AgentId; about: string; whom?: AgentId; drop: boolean } | undefined {
  if (e.kind !== "action.resolve") return undefined;
  const who = e.actors[0] as AgentId | undefined;
  const data = e.data as {
    effect?: { kind?: string; about?: unknown; whom?: unknown };
    manner?: readonly string[];
  } | null;
  const eff = data?.effect;
  if (!who || eff?.kind !== "resolve" || typeof eff.about !== "string") return undefined;
  const whom =
    typeof eff.whom === "string" && eff.whom.startsWith("agent:")
      ? (eff.whom as AgentId)
      : undefined;
  return {
    who,
    about: eff.about,
    ...(whom !== undefined ? { whom } : {}),
    drop: data?.manner?.includes("drop") === true,
  };
}

/** El id estable del objetivo de un bosquejo: `resolve:revenge:agent:7`, `resolve:wealth`. */
export function resolvedGoalId(sketch: string, whom?: AgentId): string {
  return whom === undefined ? `resolve:${sketch}` : `resolve:${sketch}:${whom}`;
}

function goalEvent(
  e: Event,
  who: AgentId,
  g: Goal,
  what: "born" | "ended",
  reason: "chosen" | "dropped",
): EventDraft {
  return {
    kind: GOAL_EVENT,
    actors: [who],
    place: e.place,
    data: {
      goal: g.id,
      layer: g.layer,
      what,
      reason,
      weight: g.weight,
      ...(g.value === undefined ? {} : { value: g.value }),
      ...(g.target === undefined ? {} : { target: g.target }),
    },
    emissions: {},
    causes: [
      { kind: "event", event: e.id },
      ...(g.originEventId === e.id ? [] : [{ kind: "event" as const, event: g.originEventId }]),
      ...(what === "ended" ? [{ kind: "state" as const, entity: who, key: "goals" }] : []),
    ],
  };
}

export function resolveGoalProcess(sketches: readonly GoalSketch[]): ProcessDef {
  return {
    id: RESOLVE_GOAL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [NPC_GOALS.name, PERSON.name],
    writes: [NPC_GOALS.name],
    run(ctx) {
      const rows = new Map<AgentId, readonly Goal[]>();
      const events: EventDraft[] = [];
      for (const e of ctx.recent) {
        const r = resolvedGoal(e);
        if (!r || !ctx.truth.get(PERSON, r.who)) continue;
        const sketch = sketchOf(r.about, sketches)?.sketch;
        if (sketch === undefined) continue;
        const goals = rows.get(r.who) ?? ctx.truth.get(NPC_GOALS, r.who)?.items ?? [];
        const id = resolvedGoalId(sketch.id, r.whom);
        if (r.drop) {
          // Sin persona nombrada deja todas las de ese bosquejo («ya no quiero vengarme»).
          const prefix = resolvedGoalId(sketch.id);
          const gone = goals.filter((g) =>
            r.whom !== undefined ? g.id === id : g.id === prefix || g.id.startsWith(`${prefix}:`),
          );
          if (gone.length === 0) continue;
          for (const g of gone) events.push(goalEvent(e, r.who, g, "ended", "dropped"));
          rows.set(
            r.who,
            goals.filter((g) => !gone.includes(g)),
          );
          continue;
        }
        if (goals.some((g) => g.id === id)) continue;
        const avenge = sketch.id === "revenge" && r.whom !== undefined;
        const goal: Goal = {
          id,
          layer: "long",
          kind: avenge ? "avenge" : "pursue",
          ...(avenge ? {} : { value: sketch.value as ValueId }),
          ...(r.whom !== undefined ? { target: r.whom } : {}),
          weight: RESOLVED_GOAL_WEIGHT,
          originEventId: e.id as EventId,
          since: e.tick,
        };
        events.push(goalEvent(e, r.who, goal, "born", "chosen"));
        rows.set(r.who, [...goals, goal]);
      }
      const changes: StateChange[] = [...rows].map(([id, items]) =>
        setComponent(NPC_GOALS, id, { items }),
      );
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
