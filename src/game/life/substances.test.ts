import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  PERSON,
  PERSON_SUBSTANCE,
  type ProcessContext,
  SUBSTANCE,
  type SubstanceDef,
  WorldTruth,
} from "../../sim/index.ts";
import { consumeDose, substancesProcess } from "./substances.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const place = { kind: "cell", cell: "cell:1" } as never;
const a = "agent:1" as AgentId;
const POISON: SubstanceDef = {
  id: "slow-poison",
  routes: { ingest: { bioavailability: 0.9, halfHours: 2 } },
  halfLifeHours: 12,
  ec50: 5,
  hill: 1,
  latencyHours: 12,
  toxicThreshold: 4,
  damagePerHourAtDouble: 0.12,
  repairHalfHours: 48,
};

function world(): WorldTruth {
  const t = new WorldTruth();
  t.set(
    ENTITY,
    a as EntityRef,
    { id: a, originEventId: "event:1" as EventId, createdAt: 0 } as never,
  );
  t.set(PERSON, a as EntityRef, { household: "household:1" } as never);
  t.set(BODY_STATE, a as EntityRef, { muscle: 0.5 } as never);
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

describe("life.substances", () => {
  it("sin dosis ni filas no hace nada", () => {
    const p = substancesProcess({ clock, placeOf: () => place });
    expect(p.run(ctx(world(), clock.day))).toEqual({});
  });

  it("una dosis letal crea la sustancia con origen y mata con causa poison", () => {
    const p = substancesProcess({
      clock,
      placeOf: () => place,
      doses: [{ def: POISON, who: a, at: 100, route: "ingest", amount: 200, source: "escenario" }],
    });
    const r = p.run(ctx(world(), clock.day));
    expect(r.events?.map((e) => e.kind)).toEqual(["body.substance_introduced", "body.died"]);
    expect(r.events?.[1]?.data).toMatchObject({ cause: "poison" });
    expect(r.changes?.some((c) => c.table === SUBSTANCE.name)).toBe(true);
  });
});

describe("consumeDose (verbo consume)", () => {
  const consumable = { good: "pipeweed", def: POISON, route: "ingest", amount: 3 } as const;

  it("suma la dosis con evento causal la primera vez y no repite el evento", () => {
    const t = world();
    const first = consumeDose(t, a, consumable, ctx(t, 500), place, 1);
    expect(first.events.map((e) => e.kind)).toEqual(["body.substance_introduced"]);
    expect(first.changes.some((c) => c.table === PERSON_SUBSTANCE.name)).toBe(true);
    expect(first.changes.some((c) => c.table === SUBSTANCE.name)).toBe(true);
    const sid = "substance:~0" as EntityRef;
    t.set(SUBSTANCE, sid, { def: POISON, source: "consume:pipeweed" } as never);
    const second = consumeDose(t, a, consumable, ctx(t, 600), place, 0);
    expect(second.events).toEqual([]);
    expect(second.changes.some((c) => c.table === SUBSTANCE.name)).toBe(false);
  });

  it("comer un lote con la sustancia: la dosis escala con los gramos (por gramo x gramos)", () => {
    const t = world();
    const tea = { ...consumable, good: "tea" };
    const small = consumeDose(t, a, { ...tea, amount: 0.5 * 10 }, ctx(t, 500), place, 0);
    const big = consumeDose(t, a, { ...tea, amount: 0.5 * 40 }, ctx(t, 500), place, 0);
    const held = (r: typeof small) =>
      JSON.stringify(r.changes.find((c) => c.table === PERSON_SUBSTANCE.name));
    expect(held(small)).not.toEqual(held(big));
    expect(small.events[0]?.data).toMatchObject({ source: "consume:tea" });
  });
});
