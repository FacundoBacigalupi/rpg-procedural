import { describe, expect, it } from "vitest";
import {
  blendQuality,
  decayBelief,
  firstBelief,
  flavorOf,
  observePrice,
  perceivedQuality,
  qualityPriceFactor,
  workingBase,
} from "./index.ts";

describe("calidad por lote", () => {
  it("el factor de precio es monótono y 1 en la referencia", () => {
    expect(qualityPriceFactor(0.7)).toBeCloseTo(1, 10);
    expect(qualityPriceFactor(0)).toBeCloseTo(0.4, 10);
    expect(qualityPriceFactor(1)).toBeCloseTo(1.5, 10);
    expect(qualityPriceFactor(0.9)).toBeGreaterThan(qualityPriceFactor(0.5));
  });

  it("mezclar pondera por gramos y buen ojo ve la calidad real", () => {
    expect(
      blendQuality([
        { grams: 300, quality: 1 },
        { grams: 100, quality: 0 },
      ]),
    ).toBeCloseTo(0.75, 10);
    expect(perceivedQuality(0.5, 1, 3)).toBe(0.5);
    expect(flavorOf(0.1)).toBe("ruin");
    expect(flavorOf(0.95)).toBe("fine");
  });
});

describe("memoria de precios", () => {
  it("observar acerca la creencia a lo visto y gana confianza", () => {
    const b = firstBelief(10, 0);
    const n = observePrice(b, 20, 3);
    expect(n.perKg).toBeGreaterThan(10);
    expect(n.perKg).toBeLessThan(20);
    expect(n.confidence).toBeGreaterThan(b.confidence);
  });

  it("la confianza se afloja sin ver precios y sin creencia manda la referencia", () => {
    let b = firstBelief(10, 0, 0.9);
    b = decayBelief(b, 360);
    expect(b.confidence).toBeLessThan(0.9);
    expect(b.confidence).toBeGreaterThan(0.05);
    expect(workingBase(undefined, 7)).toBe(7);
  });
});
