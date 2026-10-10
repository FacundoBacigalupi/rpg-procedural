import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, PlanetClock } from "../../core/index.ts";
import { LOCATION, WorldTruth } from "../../sim/index.ts";
import { cueContextOf } from "./substances.ts";

describe("life.cueContextOf local", () => {
  const clock = { day: 24000 } as unknown as PlanetClock;
  const me = "agent:1" as AgentId;
  const t = new WorldTruth();
  t.set(LOCATION, me as unknown as EntityRef, { hex: 5 } as never);
  t.set(LOCATION, "agent:2" as unknown as EntityRef, { hex: 5 } as never);
  t.set(LOCATION, "agent:3" as unknown as EntityRef, { hex: 9 } as never);

  it("por defecto: los del mismo hex y hora global", () => {
    const c = cueContextOf(t, me, 6000, clock);
    expect(c.people).toEqual(["agent:2"]);
    expect(c.hour).toBe(6);
  });

  it("opt-in: lo que cree presente y el huso local", () => {
    const c = cueContextOf(t, me, 6000, clock, {
      believedPresent: ["agent:3", "agent:1"],
      hourOffset: -8,
    });
    expect(c.people).toEqual(["agent:3"]);
    expect(c.hour).toBe(22);
  });
});
