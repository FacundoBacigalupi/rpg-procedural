import { describe, expect, it } from "vitest";
import {
  type FireNode,
  fuelLoad,
  ignitionChance,
  nextIntensity,
  responseEffort,
  spreadChance,
} from "./fire.ts";
import type { BuildingComponent } from "./tables.ts";

const node = (x: number, fuel = 1.4, firebreak = 0): FireNode => ({
  id: `n${x}`,
  at: { x, y: 0 },
  fuelLoad: fuel,
  firebreak,
});
const base = { intensity: 1, windMs: 0, windDirRad: 0, dryness: 1, wetting: 0 };

describe("fuego en la aldea", () => {
  it("el combustible pondera por masa", () => {
    const origin = "e" as never;
    const comp = (m: string, g: number): BuildingComponent => ({
      part: "walls",
      area: 1,
      condition: 1,
      quality: 1,
      defects: [],
      materials: [{ material: m, grams: g, origin }],
    });
    const f = fuelLoad([comp("straw", 100), comp("stone", 300)], (m) => (m === "straw" ? 1.4 : 0));
    expect(f).toBeCloseTo(0.35);
  });
  it("sin tormenta no hay rayo; el fogón depende del uso", () => {
    const i = { cause: "lightning", fuelLoad: 1, dryness: 1, use: 1, storm: false } as const;
    expect(ignitionChance(i)).toBe(0);
    expect(ignitionChance({ ...i, cause: "hearth", use: 0 })).toBe(0);
    expect(ignitionChance({ ...i, cause: "hearth" })).toBeGreaterThan(0);
  });
  it("el viento a favor empuja, en contra frena, y cortafuegos y piedra frenan", () => {
    const a = node(0);
    const b = node(8);
    const calm = spreadChance({ ...base, from: a, to: b });
    const favor = spreadChance({ ...base, from: a, to: b, windMs: 8, windDirRad: 0 });
    const against = spreadChance({ ...base, from: a, to: b, windMs: 8, windDirRad: Math.PI });
    expect(favor).toBeGreaterThan(calm);
    expect(against).toBeLessThan(calm);
    expect(spreadChance({ ...base, from: a, to: node(8, 1.4, 0.8) })).toBeLessThan(calm);
    expect(spreadChance({ ...base, from: a, to: node(8, 0) })).toBe(0);
    expect(spreadChance({ ...base, from: a, to: node(40) })).toBe(0);
  });
  it("la respuesta de los vecinos apaga", () => {
    const weak = responseEffort({ neighbors: 1, water: 0.1, organized: false });
    const strong = responseEffort({ neighbors: 10, water: 1, organized: true });
    expect(strong).toBeGreaterThan(weak);
    expect(nextIntensity(0.8, 0.5, strong, 0)).toBeLessThan(nextIntensity(0.8, 0.5, weak, 0));
  });
});
