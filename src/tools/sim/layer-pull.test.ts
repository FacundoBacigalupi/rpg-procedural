import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { GOAL_PULL, type Goal, LAYER_PULL } from "../../sim/index.ts";
import { pushOf } from "./layer-pull.ts";

const goal = (layer: Goal["layer"], weight: number): Goal => ({
  id: `${layer}:x`,
  layer,
  kind: "pursue",
  value: "safety",
  weight,
  originEventId: makeId("event", 1),
  since: 0,
});

describe("tools.sim.layer-pull", () => {
  it("separa el empuje del núcleo del de las capas y respeta el empuje inyectado", () => {
    const goals = [goal("core", 1), goal("long", 1), goal("short", 0.5), goal("immediate", 1)];
    const p = pushOf(goals);
    expect(p.core).toBe(GOAL_PULL);
    expect(p.layers).toBeCloseTo(LAYER_PULL.long + 0.5 * LAYER_PULL.short, 10);
    expect(pushOf(goals, { long: 0, medium: 0, short: 0 }).layers).toBe(0);
  });
});
