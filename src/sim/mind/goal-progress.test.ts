import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, makeId, type Tick } from "../../core/index.ts";
import type { Belief, Beliefs } from "../knowledge/index.ts";
import {
  GOAL_COMPLETION_MIN_CONFIDENCE,
  type GoalDeathEvidence,
  goalCompletionsFromBeliefs,
} from "./goal-progress.ts";
import type { Goal } from "./goals.ts";

const target = makeId("agent", 7);
const now = 50_000 as Tick;
const goal: Goal = {
  id: `core:avenge:${target}`,
  layer: "core",
  kind: "avenge",
  target,
  weight: 0.7,
  originEventId: makeId("event", 2),
  since: 100,
};
const pursue: Goal = {
  id: "core:immortality",
  layer: "core",
  kind: "pursue",
  value: "immortality",
  weight: 0.9,
  originEventId: makeId("event", 3),
  since: 100,
};
const deathEvent = makeId("event", 20);

function belief(value: boolean, confidence: number, event?: EventId): Belief {
  const source = {
    kind: "percept" as const,
    percept: "percept:death-read",
    tick: now,
    ...(event === undefined ? {} : { event }),
  };
  return {
    prop: { kind: "attr", subject: target, attr: "alive" },
    value,
    confidence,
    asOf: now,
    learnedAt: now,
    sources: [source],
    salience: 1,
    measured: now,
  };
}

function beliefs(value: boolean, confidence: number, event?: EventId): Beliefs {
  return { items: [belief(value, confidence, event)] };
}

describe("sim.mind.goal-progress", () => {
  it("solo completa venganza ante una creencia firme de muerte con evento citable", () => {
    const result = goalCompletionsFromBeliefs([goal, pursue], beliefs(false, 0.9, deathEvent), now);
    expect(result).toEqual([{ goalId: goal.id, cause: deathEvent, at: now, original: goal }]);
    expect(result[0]?.original.originEventId).toBe(goal.originEventId);
    expect(result[0]?.cause).not.toBe(goal.originEventId);
  });

  it("no completa si el blanco se cree vivo, es desconocido o la fuente no cita evento", () => {
    expect(goalCompletionsFromBeliefs([goal], beliefs(true, 0.99, deathEvent), now)).toEqual([]);
    expect(goalCompletionsFromBeliefs([goal], undefined, now)).toEqual([]);
    expect(goalCompletionsFromBeliefs([goal], beliefs(false, 0.99), now)).toEqual([]);
    const told: Beliefs = {
      items: [
        {
          ...belief(false, 0.99),
          sources: [{ kind: "told", from: "agent:8" as AgentId, tick: now }],
        },
      ],
    };
    expect(goalCompletionsFromBeliefs([goal], told, now)).toEqual([]);
    const reported: GoalDeathEvidence[] = [{ target, cause: deathEvent }];
    expect(goalCompletionsFromBeliefs([goal], told, now, reported)).toEqual([
      { goalId: goal.id, cause: deathEvent, at: now, original: goal },
    ]);
  });

  it("usa confianza envejecida y rechaza un event id mal formado", () => {
    expect(GOAL_COMPLETION_MIN_CONFIDENCE).toBe(0.6);
    expect(goalCompletionsFromBeliefs([goal], beliefs(false, 0.59, deathEvent), now)).toEqual([]);
    const later = (now + 14 * 86_400) as Tick;
    expect(goalCompletionsFromBeliefs([goal], beliefs(false, 0.9, deathEvent), later)).toEqual([]);
    const future: Beliefs = {
      items: [{ ...belief(false, 0.99, deathEvent), asOf: later }],
    };
    expect(goalCompletionsFromBeliefs([goal], future, now)).toEqual([]);
    expect(
      goalCompletionsFromBeliefs([goal], beliefs(false, 0.9, "event:00" as EventId), now),
    ).toEqual([]);
    const told: Beliefs = {
      items: [
        {
          ...belief(false, 0.9),
          sources: [{ kind: "told", from: "agent:8" as AgentId, tick: now }],
        },
      ],
    };
    expect(
      goalCompletionsFromBeliefs([goal], told, now, [{ target, cause: "event:00" as EventId }]),
    ).toEqual([]);
  });

  it("produce el mismo resultado con las mismas metas y creencias", () => {
    const known = beliefs(false, 0.8, deathEvent);
    expect(goalCompletionsFromBeliefs([pursue, goal], known, now)).toEqual(
      goalCompletionsFromBeliefs([pursue, goal], known, now),
    );
  });
});
