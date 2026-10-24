import { describe, expect, it } from "vitest";
import {
  accrueDeadwood,
  DEADWOOD_DECAY,
  deadwoodFall,
  deadwoodReach,
  forageCapacity,
  forageReach,
  regrowForage,
} from "./wild.ts";

describe("forraje silvestre", () => {
  it("el rebrote tiende al techo sin pasarlo y no muere del todo", () => {
    const cap = forageCapacity(100);
    expect(regrowForage(0, cap, 1)).toBeGreaterThan(0);
    let s = cap * 0.1;
    for (let i = 0; i < 400; i++) s = regrowForage(s, cap, 1);
    expect(s).toBeLessThanOrEqual(cap);
    expect(s).toBeGreaterThan(cap * 0.99);
  });
  it("el rendimiento por hora baja con el stock", () => {
    const cap = forageCapacity(100);
    expect(forageReach(cap).perHour).toBeGreaterThan(forageReach(cap * 0.1).perHour);
    expect(forageReach(0).grams).toBe(0);
  });
});

describe("leña caída", () => {
  it("se junta hacia el equilibrio entre lo que cae y lo que se pudre, por tramos o de una", () => {
    const fall = deadwoodFall(100);
    const eq = fall / DEADWOOD_DECAY;
    let d = 0;
    for (let i = 0; i < 30; i++) d = accrueDeadwood(d, fall, 1);
    expect(d).toBeCloseTo(accrueDeadwood(0, fall, 30), 6);
    expect(accrueDeadwood(eq, fall, 50)).toBeCloseTo(eq, 6);
    expect(accrueDeadwood(eq * 2, fall, 100)).toBeLessThan(eq * 2);
    expect(accrueDeadwood(0, fall, 100_000)).toBeCloseTo(eq, 3);
  });

  it("lo que se alcanza rinde menos por hora con menos leña en el suelo", () => {
    const eq = deadwoodFall(100) / DEADWOOD_DECAY;
    expect(deadwoodReach(eq).perHour).toBeGreaterThan(deadwoodReach(eq * 0.1).perHour);
    expect(deadwoodReach(0).grams).toBe(0);
  });
});
