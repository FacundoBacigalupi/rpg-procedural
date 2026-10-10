import { describe, expect, it } from "vitest";
import { hearthBurn, hearthDistanceM, hearthRadiantC } from "./hearth.ts";

const h = { burnGramsPerHour: 1000, litHoursPerDay: 12 };

describe("hogares", () => {
  it("quema lo que el fuego pide si hay leña, y no más de la que hay", () => {
    expect(hearthBurn(h, 50000, 1)).toEqual({ burnedG: 12000, intensity: 0.5 });
    const short = hearthBurn(h, 6000, 1);
    expect(short.burnedG).toBe(6000);
    expect(short.intensity).toBeCloseTo(0.25, 5);
    expect(hearthBurn(h, 0, 1)).toEqual({ burnedG: 0, intensity: 0 });
  });

  it("calienta más de cerca y más con más fuego", () => {
    expect(hearthDistanceM(4)).toBeLessThan(hearthDistanceM(100));
    expect(hearthRadiantC([{ intensity: 1 }], 4)).toBeGreaterThan(
      hearthRadiantC([{ intensity: 1 }], 100),
    );
    expect(hearthRadiantC([], 4)).toBe(0);
  });
});
