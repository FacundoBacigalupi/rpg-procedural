import { describe, expect, it } from "vitest";
import {
  believedQuality,
  claimedQuality,
  discoveryChance,
  isScam,
  scamAftermath,
  scamMargin,
} from "./index.ts";

describe("estafa de calidad", () => {
  it("el ojo perfecto no se deja engañar y la confianza con mal ojo sí", () => {
    const claimed = claimedQuality(0.3, 0.4);
    expect(believedQuality(0.3, claimed, 1, 0, 1)).toBeCloseTo(0.3, 10);
    const b = believedQuality(0.3, claimed, 0, 0, 1);
    expect(b).toBeCloseTo(0.7, 10);
    expect(isScam(0.3, b)).toBe(true);
    expect(scamMargin(0.3, b)).toBeGreaterThan(0);
    expect(believedQuality(0.3, claimed, 0, 0, 0)).toBeCloseTo(0.3, 10);
  });

  it("descubrir sube con la brecha, el uso y el tasador; sin brecha es 0", () => {
    expect(discoveryChance(0.5, 0.5, 0.5, 30)).toBe(0);
    const lo = discoveryChance(0.3, 0.6, 0.2, 1);
    expect(discoveryChance(0.3, 0.6, 0.2, 30)).toBeGreaterThan(lo);
    expect(discoveryChance(0.3, 0.6, 0.2, 1, true)).toBeGreaterThan(lo);
    const a = scamAftermath(0.3, 0.7, 1);
    expect(a.trustDrop).toBeGreaterThan(scamAftermath(0.3, 0.7, 0).trustDrop);
    expect(a.overpaid).toBeGreaterThan(0);
  });
});
