// Las hierbas espirituales (novel2-pills-herbs): crecen solo con qi por encima del umbral y rebrotan
// hacia su techo.
import { describe, expect, it } from "vitest";
import { type HerbDef, herbCapacity, qiRatio, regrowHerb } from "./herb.ts";
import type { PlaceQi } from "./meditation.ts";

const grass: HerbDef = {
  id: "g",
  good: "spirit-herb",
  minRatio: 1.2,
  gramsPerRatio: 1000,
  qiPerGram: 1,
  regrowth: 0.05,
};
const at = (ratio: number): PlaceQi => ({
  cell: 0,
  level: ratio * 10,
  reference: 10,
  regenPerYear: 1,
  elements: {},
});

describe("hierbas espirituales", () => {
  it("el techo crece con el qi sobre el umbral; por debajo, nada", () => {
    expect(qiRatio(at(2))).toBe(2);
    expect(herbCapacity(grass, at(1))).toBe(0);
    expect(herbCapacity(grass, at(2.2))).toBeCloseTo(1000);
  });
  it("rebrota hacia el techo, nunca lo pasa, y sin techo se seca", () => {
    const a = regrowHerb(grass, 0, 1000, 10);
    const b = regrowHerb(grass, 0, 1000, 100);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1000);
    expect(regrowHerb(grass, 1000, 1000, 5)).toBeCloseTo(1000);
    expect(regrowHerb(grass, 500, 0, 5)).toBe(0);
  });
});
