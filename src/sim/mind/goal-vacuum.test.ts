import { describe, expect, it } from "vitest";
import { type EventId, makeId, type Tick } from "../../core/index.ts";
import type { GoalCompletion } from "./goal-progress.ts";
import { goalVacuumFromCompletions } from "./goal-vacuum.ts";
import type { Goal } from "./goals.ts";

const now = 500 as Tick;
const completion = (
  id: string,
  at: number,
  layer: Goal["layer"] = "core",
  origin = makeId("event", 1),
  cause = makeId("event", 2),
): GoalCompletion => {
  const original: Goal = {
    id,
    layer,
    kind: "avenge",
    target: makeId("agent", 7),
    weight: 0.7,
    originEventId: origin,
    since: 100 as Tick,
  };
  return { goalId: id, at: at as Tick, cause, original };
};

describe("sim.mind.goal-vacuum", () => {
  it("deriva vacío del núcleo subjetivamente cumplido, no de capas ni necesidades", () => {
    const done = completion("core:family_first", 400);
    expect(goalVacuumFromCompletions([], [done], now)).toEqual({
      since: 400,
      elapsed: 100,
      sources: [
        {
          goalId: done.goalId,
          at: done.at,
          weight: done.original.weight,
          origin: done.original.originEventId,
          cause: done.cause,
        },
      ],
    });
    expect(goalVacuumFromCompletions([], [completion("short:hunt", 400, "short")], now)).toBe(
      undefined,
    );
    const continuous = {
      ...completion("core:family", 400),
      original: {
        ...completion("core:family", 400).original,
        kind: "pursue" as const,
        target: undefined,
        value: "family" as Goal["value"],
      },
    };
    expect(goalVacuumFromCompletions([], [continuous], now)).toBeUndefined();
  });

  it("un pursue continuo no reemplaza el ancla perdida; un núcleo concreto sí", () => {
    const family: Goal = {
      id: "core:family_first",
      layer: "core",
      kind: "pursue",
      value: "family",
      weight: 0.5,
      originEventId: makeId("event", 3),
      since: 450 as Tick,
    };
    const completedRevenge = completion("core:revenge:agent:7", 400);
    expect(goalVacuumFromCompletions([family], [completedRevenge], now)?.since).toBe(400);
    const concrete: Goal = {
      ...completedRevenge.original,
      id: "core:revenge:agent:8",
      kind: "avenge",
      target: makeId("agent", 8),
      since: 300 as Tick,
    };
    expect(goalVacuumFromCompletions([concrete], [completedRevenge], now)).toBeUndefined();
    expect(
      goalVacuumFromCompletions([{ ...concrete, since: 450 as Tick }], [completedRevenge], now),
    ).toBeUndefined();
    expect(
      goalVacuumFromCompletions([{ ...family, layer: "short" }], [completedRevenge], now),
    ).not.toBeUndefined();
  });

  it("ignora fuentes futuras o no citables y ordena completions de forma estable", () => {
    const a = completion("core:z", 300, "core", makeId("event", 8), makeId("event", 9));
    const b = completion("core:a", 300, "core", makeId("event", 6), makeId("event", 7));
    const future = completion("core:future", 501);
    const futureOrigin = {
      ...completion("core:future-origin", 300),
      original: { ...completion("core:future-origin", 300).original, since: 501 as Tick },
    };
    const invalid = completion("core:invalid", 200, "core", "event:00" as EventId);
    const invalidCause = completion(
      "core:invalid-cause",
      200,
      "core",
      makeId("event", 4),
      "bad" as EventId,
    );
    const mismatched = { ...completion("core:actual", 200), goalId: "core:invented" };
    const input = [a, future, futureOrigin, invalid, invalidCause, mismatched, b];
    const result = goalVacuumFromCompletions([], input, now);
    expect(result?.sources.map((source) => source.goalId)).toEqual(["core:a", "core:z"]);
    expect(result).toEqual(goalVacuumFromCompletions([], [...input].reverse(), now));
    expect(result?.since).toBe(300);
  });
});
