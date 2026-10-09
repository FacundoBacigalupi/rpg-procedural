import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, Event, HolderRef, LedgerUnit, Tick } from "../../core/index.ts";
import { type Beliefs, type Location, learn } from "../../sim/index.ts";
import { checkInventory, noticeChange, touchedBy } from "./inventory-belief.ts";
import { believesAlive, whereaboutsFromBeliefs } from "./known.ts";

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

describe("believesAlive", () => {
  function sawAlive(value: boolean, tick: Tick): Beliefs {
    return learn(
      undefined,
      {
        prop: { kind: "attr", subject: who, attr: "alive" },
        value,
        confidence: 0.9,
        asOf: tick,
        source: { kind: "percept", percept: "p", tick },
      },
      tick,
    );
  }

  it("lo cree vivo si lo vio vivo hace poco", () => {
    expect(believesAlive(sawAlive(true, now), who, now)).toBe(true);
  });

  it("sin creencia, o creído muerto, no es un fantasma", () => {
    expect(believesAlive(undefined, who, now)).toBe(false);
    expect(believesAlive(sawAlive(false, now), who, now)).toBe(false);
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

describe("touchedBy", () => {
  const bread = "good:bread" as LedgerUnit;
  const home = "household:1" as unknown as HolderRef;
  const ev = (effect: object) => ({ data: { effect } }) as unknown as Event;

  it("comer de la despensa toca la despensa, no el bolsillo", () => {
    expect(touchedBy(ev({ kind: "eat", good: bread, from: home }), home)).toEqual([
      { unit: bread, carried: false, larder: true },
    ]);
  });

  it("comprar toca el bien y las monedas del bolsillo", () => {
    const t = touchedBy(ev({ kind: "trade", good: bread, coins: 3 }), home);
    expect(t.map((x) => x.unit)).toEqual([bread, "coin:copper"]);
    expect(t.every((x) => x.carried && !x.larder)).toBe(true);
  });

  it("lo que no mueve bienes no toca nada", () => {
    expect(touchedBy(ev({ kind: "observe", acuity: 1 }), home)).toEqual([]);
  });
});
