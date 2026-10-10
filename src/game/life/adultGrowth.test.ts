import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  ENTITY,
  GROWTH_SEQUELAE,
  INNATE,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { adultGrowthProcess } from "./adultGrowth.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const a = "agent:1" as AgentId;
const plan = { id: "human", physiology: { refMassKg: 60 } } as unknown as BodyPlanDef;

function world(sequelae: boolean): WorldTruth {
  const t = new WorldTruth();
  const id = a as EntityRef;
  t.set(ENTITY, id, { id: a, originEventId: "event:1" as EventId, createdAt: 0 } as never);
  t.set(PERSON, id, { born: 0, sex: "female" } as never);
  t.set(INNATE, id, {} as never);
  t.set(BODY_STATE, id, {
    plan: "human",
    massKg: 20,
    glycogen: 100,
    fat: 1000,
    death: null,
  } as never);
  if (sequelae) t.set(GROWTH_SEQUELAE, id, { stunt: 0.2, cognitiveLoss: 0 } as never);
  return t;
}
const ctx = (truth: WorldTruth, years: number) =>
  ({
    now: clock.year * years,
    window: clock.day,
    truth,
    rng: Rng.root(1),
    newId: () => "x",
  }) as unknown as ProcessContext;

const run = (truth: WorldTruth, years: number) =>
  adultGrowthProcess({ clock, plans: [plan], traits: [] }).run(ctx(truth, years));

describe("life.adult-growth", () => {
  it("un menor no cambia", () => {
    expect(run(world(false), 10)).toEqual({});
  });

  it("al llegar a 18 llega a la masa adulta, menor con secuelas, y ya no reescribe", () => {
    const grown = run(world(false), 18).changes?.[0] as never as { value: { massKg: number } };
    const stunted = run(world(true), 18).changes?.[0] as never as { value: { massKg: number } };
    expect(grown.value.massKg).toBeGreaterThan(50);
    expect(stunted.value.massKg).toBeLessThan(grown.value.massKg);
  });
});
