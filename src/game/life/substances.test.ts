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
import {
  consumeDose,
  cravingBorrowAsks,
  cravingBorrowMood,
  cravingBuyGoods,
  cravingBuyMood,
  cravingGatherMood,
  scaledDose,
  substancesProcess,
} from "./substances.ts";

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

describe("scaledDose (beber con sustancia)", () => {
  it("escala la dosis por litro y la deja fuera del lote original", () => {
    const tea = { good: "tea", def: POISON, route: "ingest", amount: 2 } as const;
    expect(scaledDose(tea, 0.75).amount).toBeCloseTo(1.5);
    expect(tea.amount).toBe(2);
  });
});

describe("comprar lo que se consume", () => {
  const o = { minCraving: 0.4, weight: 1, refPrice: 10 };
  it("solo con ansia alta y sin existencias, por nombre", () => {
    const names = [
      { name: "tea", have: 0 },
      { name: "ale", have: 3 },
      { name: "bark", have: 0 },
    ];
    expect(cravingBuyGoods(0.3, names, o)).toEqual([]);
    expect(cravingBuyGoods(0.5, names, o)).toEqual(["bark", "tea"]);
  });
  it("el empuje crece con el ansia y cae con el precio", () => {
    expect(cravingBuyMood(1, undefined, o)).toBe(1);
    expect(cravingBuyMood(1, 10, o)).toBe(0.5);
    expect(cravingBuyMood(0.5, 0, o)).toBe(0.5);
  });
  it("recolectar: el empuje crece con el ansia, sin precio", () => {
    const g = { minCraving: 0.4, weight: 0.8 };
    expect(cravingGatherMood(1, g)).toBe(0.8);
    expect(cravingGatherMood(0.5, g)).toBe(0.4);
    expect(cravingBuyGoods(0.3, [{ name: "bark", have: 0 }], g)).toEqual([]);
  });
});

describe("pedir prestada la sustancia", () => {
  const o = { minCraving: 0.4, weight: 1 };
  const has = (about: string, value: string, confidence: number) => ({
    rumor: { mold: "attr", about, attr: "has", value } as const,
    confidence,
  });
  const wants = [
    { name: "tea", have: 0 },
    { name: "ale", have: 2 },
  ];
  it("solo con ansia alta, sin existencias y a conocidos, por lo que cree", () => {
    const rumors = [
      has("b", "tea", 0.5),
      has("a", "tea", 0.4),
      has("a", "tea", 0.8),
      has("z", "tea", 1),
      has("a", "ale", 1),
    ];
    const known = new Set(["a", "b"]);
    expect(cravingBorrowAsks(0.3, wants, rumors, known, o)).toEqual([]);
    expect(cravingBorrowAsks(0.5, wants, rumors, known, o)).toEqual([
      { lender: "a", name: "tea", confidence: 0.8 },
      { lender: "b", name: "tea", confidence: 0.5 },
    ]);
  });
  it("el empuje crece con el ansia y con la confianza", () => {
    expect(cravingBorrowMood(1, 1, o)).toBe(1);
    expect(cravingBorrowMood(0.5, 0.5, o)).toBe(0.25);
  });
});
