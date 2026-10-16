import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { ENTITY, INNATE, PERSON, type Trait, WorldTruth } from "../../sim/index.ts";
import { schemerViewOf } from "./schemepolicy.ts";
import type { SchemeSeed } from "./schemes.ts";

const a = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n);

const traits = ["boldness", "warmth", "intellect", "willpower", "reactivity", "constitution"].map(
  (id) => ({ id, mean: 0, sd: 1 }),
) as unknown as readonly Trait[];

const seed: SchemeSeed = {
  key: "s",
  owner: a(1),
  target: a(2),
  motive: "revenge",
  origin: ev(1),
  startDay: 0,
};

function world(owner: Record<string, number>, target: Record<string, number> = {}) {
  const t = new WorldTruth();
  for (const [n, v] of [
    [1, owner],
    [2, target],
  ] as const) {
    t.set(ENTITY, a(n), { id: a(n), originEventId: ev(1), createdAt: 0 } as never);
    t.set(PERSON, a(n), { household: `h${n}`, sex: "female" } as never);
    t.set(INNATE, a(n), v as never);
  }
  return t;
}

const make = () => schemerViewOf({ traits, dims: [], bonds: [] });

describe("schemerViewOf", () => {
  it("lee rasgos: el audaz y duro sale más audaz y frío que el manso", () => {
    const bold = make()(world({ boldness: 2, warmth: -2, willpower: -2 }), seed, 0);
    const meek = make()(world({ boldness: -2, warmth: 2, willpower: 2 }), seed, 0);
    expect(bold.boldness).toBeGreaterThan(meek.boldness);
    expect(bold.warmth).toBeLessThan(meek.warmth);
    expect(bold.honor).toBeLessThan(meek.honor);
    for (const k of ["boldness", "warmth", "honor", "fear", "intellect"] as const) {
      expect(bold[k]).toBeGreaterThanOrEqual(0);
      expect(bold[k]).toBeLessThanOrEqual(1);
    }
  });

  it("cree más fuerte al blanco de más constitución y es determinista", () => {
    const weak = make()(world({ constitution: 0 }, { constitution: -2 }), seed, 0);
    const strong = make()(world({ constitution: 0 }, { constitution: 2 }), seed, 0);
    expect(strong.believedTargetStrength).toBeGreaterThan(weak.believedTargetStrength);
    expect(make()(world({ boldness: 1 }), seed, 0)).toEqual(
      make()(world({ boldness: 1 }), seed, 0),
    );
  });

  it("sin rasgos ni relación da el término medio y el motivo de la semilla", () => {
    const v = make()(new WorldTruth(), seed, 0);
    expect(v.motive).toBe("revenge");
    expect(v.boldness).toBe(0.5);
    expect(v.affinity).toBe(0);
  });
});
