import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import { type PathogenDef, WorldTruth } from "../../sim/index.ts";
import { type AfflictedOrigin, journeySeeds } from "./journey-arrivals.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const plague: PathogenDef = {
  id: "plague",
  routes: { air: 1, contact: 1 },
  incubationHours: 24,
  courseHours: 240,
  contagiousFrom: 0.2,
  transmissibility: 80,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};
const cause = { kind: "event", event: "event:9" as EventId } as const;
const origin: AfflictedOrigin = { hex: 7, def: plague, since: 0, cause, label: "Valleclaro" };

function world(trips: Record<string, number | undefined>, since = 100000): WorldTruth {
  const t = new WorldTruth();
  for (const [id, from] of Object.entries(trips)) {
    t.set(
      NPC_JOURNEY,
      id as AgentId,
      {
        place: "x",
        since,
        decision: "d",
        ...(from === undefined ? {} : { from }),
      } as never,
    );
  }
  return t;
}

describe("journeySeeds", () => {
  const now = 100000 + 3600;
  it("solo siembra a quien salió de un origen afligido, con la epidemia como causa", () => {
    const t = world({ "agent:1": 7, "agent:2": 8, "agent:3": undefined });
    let all: ReturnType<typeof journeySeeds> = [];
    for (let s = 1; s <= 30; s++) {
      all = all.concat(journeySeeds(Rng.root(s), t, now, clock, [origin]));
    }
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.carrier).toBe("agent:1");
      expect(s.causes).toEqual([cause]);
      expect(s.perCarrier).toBe(true);
      expect(s.source).toContain("Valleclaro");
    }
  });
  it("sin orígenes, sin viajes o con el viaje viejo no hay semillas; es determinista", () => {
    const t = world({ "agent:1": 7 });
    expect(journeySeeds(Rng.root(1), t, now, clock, [])).toEqual([]);
    expect(journeySeeds(Rng.root(1), new WorldTruth(), now, clock, [origin])).toEqual([]);
    expect(journeySeeds(Rng.root(1), t, now + clock.day, clock, [origin])).toEqual([]);
    expect(journeySeeds(Rng.root(1), t, now, clock, [{ ...origin, since: 200000 }])).toEqual([]);
    expect(journeySeeds(Rng.root(4), t, now, clock, [origin])).toEqual(
      journeySeeds(Rng.root(4), t, now, clock, [origin]),
    );
  });
});
