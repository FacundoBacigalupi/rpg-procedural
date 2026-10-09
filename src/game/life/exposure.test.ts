import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  INFECTION,
  LOCATION,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { exposureProcess } from "./exposure.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const flu: PathogenDef = {
  id: "flu",
  routes: { air: 1, contact: 1 },
  incubationHours: 24,
  courseHours: 48,
  contagiousFrom: 0.5,
  transmissibility: 50,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};
const a = "agent:1" as AgentId;
const b = "agent:2" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;

function world(): WorldTruth {
  const t = new WorldTruth();
  for (const id of [a, b]) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(PERSON, id as EntityRef, { household: "household:1" } as never);
    t.set(BODY_STATE, id as EntityRef, { muscle: 0.5 } as never);
  }
  return t;
}

function ctx(truth: WorldTruth, now: number): ProcessContext {
  let n = 0;
  return {
    now,
    window: clock.day,
    truth,
    rng: Rng.root(1),
    newId: (k: string) => `${k}:~${n++}`,
  } as unknown as ProcessContext;
}

describe("life.exposure", () => {
  it("sin patógeno sembrado no hace nada", () => {
    const p = exposureProcess({ clock, placeOf: () => place });
    expect(p.run(ctx(world(), clock.day * 3))).toEqual({});
  });

  it("la siembra explícita crea el patógeno con origen y luego contagia al hogar", () => {
    const t = world();
    const p = exposureProcess({
      clock,
      placeOf: () => place,
      seeds: [{ def: flu, carrier: a, from: 0, source: "escenario" }],
    });
    const seeded = p.run(ctx(t, 0));
    expect(seeded.events?.[0]?.kind).toBe("body.pathogen_introduced");
    expect(seeded.changes?.some((c) => c.table === PATHOGEN.name)).toBe(true);
    // Aplicado a mano: el portador ya tiene síntomas y el otro comparte hogar.
    t.set(PATHOGEN, "pathogen:1" as EntityRef, { def: flu, source: "escenario" });
    t.set(INFECTION, a as EntityRef, {
      infections: [
        { pathogen: "flu", exposedAt: 0, dose: 1, fatal: false, cause: "event:9" as EventId },
      ],
      immunities: [],
      ill: [],
    });
    const out = p.run(ctx(t, clock.day * 2));
    expect(out.events?.some((e) => e.kind === "body.infected" && e.actors[0] === b)).toBe(true);
    expect(out.changes?.some((c) => c.table === INFECTION.name && c.id === b)).toBe(true);
    // Determinista.
    expect(p.run(ctx(t, clock.day * 2))).toEqual(out);
  });
});

describe("life.exposure fuera del hogar", () => {
  const c = "agent:3" as AgentId;
  it("contagia a quien comparte lugar con un contagioso aunque sea de otro hogar, y no a quien está lejos", () => {
    const t = world();
    t.set(
      ENTITY,
      c as EntityRef,
      { id: c, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(PERSON, c as EntityRef, { household: "household:2" } as never);
    t.set(BODY_STATE, c as EntityRef, { muscle: 0.5 } as never);
    t.set(PERSON, b as EntityRef, { household: "household:3" } as never);
    t.set(PATHOGEN, "pathogen:1" as EntityRef, { def: flu, source: "escenario" });
    t.set(INFECTION, a as EntityRef, {
      infections: [
        { pathogen: "flu", exposedAt: 0, dose: 1, fatal: false, cause: "event:9" as EventId },
      ],
      immunities: [],
      ill: [],
    });
    t.set(LOCATION, a as EntityRef, { hex: 5, space: "square" });
    t.set(LOCATION, b as EntityRef, { hex: 5, space: "square" });
    t.set(LOCATION, c as EntityRef, { hex: 9 });
    const p = exposureProcess({ clock, placeOf: () => place });
    const out = p.run(ctx(t, clock.day * 2));
    expect(out.events?.some((e) => e.kind === "body.infected" && e.actors[0] === b)).toBe(true);
    expect(out.events?.some((e) => e.actors[0] === c)).toBe(false);
  });
});
