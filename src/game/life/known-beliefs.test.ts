import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, LedgerUnit, Tick } from "../../core/index.ts";
import { type Beliefs, type Location, learn } from "../../sim/index.ts";
import { checkInventory, noticeChange } from "./inventory-belief.ts";
import { whereaboutsFromBeliefs } from "./known.ts";

const who = "agent:7" as AgentId;
const here: Location = { hex: 5, space: "house" };
const now = 100_000 as Tick;

function sawAt(loc: Location, tick: Tick): Beliefs {
  return learn(
    undefined,
    {
      prop: { kind: "attr", subject: who, attr: "at" },
      value: loc,
      confidence: 0.9,
      asOf: tick,
      source: { kind: "percept", percept: "p", tick },
    },
    tick,
  );
}

describe("whereaboutsFromBeliefs", () => {
  it("sin creencia no sabe dónde está", () => {
    expect(whereaboutsFromBeliefs(undefined, who, here, now)).toEqual({
      at: undefined,
      present: false,
      believed: false,
    });
  });

  it("lo vio acá hace un rato: presente y en su hex", () => {
    const r = whereaboutsFromBeliefs(sawAt(here, now), who, here, now);
    expect(r).toEqual({ at: 5, present: true, believed: true });
  });

  it("lo vio en otro lado: sabe dónde, no está presente", () => {
    const r = whereaboutsFromBeliefs(sawAt({ hex: 9 }, now), who, here, now);
    expect(r.at).toBe(9);
    expect(r.present).toBe(false);
  });

  it("la creencia vieja deja el último lugar pero ya no presente", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 60 }), (days) => {
        const later = (now + days * 86_400) as Tick;
        const r = whereaboutsFromBeliefs(sawAt(here, now), who, here, later);
        expect(r.present).toBe(false);
        expect(r.at).toBe(5);
      }),
    );
  });
});

describe("inventario creído", () => {
  const bread = "good:bread" as LedgerUnit;
  const copper = "copper" as LedgerUnit;

  it("revisar guarda lo que hay, ordenado y sin ceros", () => {
    const b = checkInventory(
      [
        { unit: copper, amount: 30 },
        { unit: bread, amount: 0 },
      ],
      [],
      now,
    );
    expect(b.carried).toEqual([{ unit: copper, amount: 30 }]);
    expect(b.asOf).toBe(now);
  });

  it("noticeChange corrige solo esa unidad", () => {
    const b = checkInventory(
      [
        { unit: copper, amount: 30 },
        { unit: bread, amount: 800 },
      ],
      [],
      now,
    );
    const after = noticeChange(b, "carried", copper, 0, (now + 10) as Tick);
    expect(after.carried).toEqual([{ unit: bread, amount: 800 }]);
    expect(b.carried).toHaveLength(2);
  });
});
