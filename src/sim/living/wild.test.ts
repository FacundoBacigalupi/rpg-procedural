import { describe, expect, it } from "vitest";
import { forageCapacity, forageReach, regrowForage } from "./wild.ts";

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
