import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  DEFICIENCY_EFFECTS,
  ENTITY,
  GROWTH_SEQUELAE,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { growthSequelaeProcess } from "./growthSequelae.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const a = "agent:1" as AgentId;
const effects = { growth: 0.5, cognition: 0.5 } as never;

function world(withEffects: boolean): WorldTruth {
  const t = new WorldTruth();
  t.set(
    ENTITY,
    a as EntityRef,
    { id: a, originEventId: "event:1" as EventId, createdAt: 0 } as never,
  );
  t.set(PERSON, a as EntityRef, { born: 0 } as never);
  if (withEffects) t.set(DEFICIENCY_EFFECTS, a as EntityRef, effects);
  return t;
}
const ctx = (truth: WorldTruth) =>
  ({
    now: clock.year * 2,
    window: clock.day * 10,
    truth,
    rng: Rng.root(1),
    newId: () => "x",
  }) as unknown as ProcessContext;

describe("life.growth-sequelae", () => {
  it("sin carencia no escribe nada", () => {
    expect(growthSequelaeProcess({ clock }).run(ctx(world(false)))).toEqual({});
  });

  it("un niño con carencia acumula secuelas en su tabla", () => {
    const out = growthSequelaeProcess({ clock }).run(ctx(world(true)));
    const ch = out.changes?.filter((c) => c.table === GROWTH_SEQUELAE.name) ?? [];
    expect(ch).toHaveLength(1);
  });
});
