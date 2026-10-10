import { describe, expect, it } from "vitest";
import {
  adulterate,
  believedQuality,
  claimedQuality,
  discoveryChance,
  fillerFor,
  fillerNoticeChance,
  inflateFor,
  isScam,
  scamAftermath,
  scamMargin,
  trustFromRelation,
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

describe("política de estafa", () => {
  it("el honesto o el que quiere al comprador no infla; la necesidad empuja", () => {
    expect(inflateFor({ honesty: 1, boldness: 1, need: 1 })).toBe(0);
    expect(inflateFor({ honesty: 0.1, boldness: 0.5, need: 1, care: 1 })).toBe(0);
    const calm = inflateFor({ honesty: 0.2, boldness: 0.5, need: 0 });
    const needy = inflateFor({ honesty: 0.2, boldness: 0.5, need: 1 });
    expect(needy).toBeGreaterThan(calm);
    expect(needy).toBeLessThanOrEqual(0.4);
  });

  it("la confianza sale de la relación: el extraño 0.5, el resentido menos", () => {
    expect(trustFromRelation({})).toBe(0.5);
    expect(trustFromRelation({ trust: 0.8, affection: 0.5 })).toBeGreaterThan(0.5);
    expect(trustFromRelation({ trust: -0.5, resentment: 0.8 })).toBeLessThan(0.3);
  });
});

describe("mezclar como estafa", () => {
  it("el relleno conserva la masa y baja la calidad", () => {
    const a = adulterate(1000, 0.8, 250);
    expect(a.grams).toBe(1250);
    expect(a.quality).toBeCloseTo(0.64, 10);
    expect(a.fillerFraction).toBeCloseTo(0.2, 10);
    expect(adulterate(0, 0.5, 0).fillerFraction).toBe(0);
  });

  it("el honesto no rellena; el tope es 30% y el ojo nota más", () => {
    expect(fillerFor(1000, 0)).toBe(0);
    const g = fillerFor(1000, 0.4);
    expect(adulterate(1000, 0.8, g).fillerFraction).toBeCloseTo(0.3, 10);
    expect(fillerNoticeChance(0.2, 1)).toBeGreaterThan(fillerNoticeChance(0.2, 0));
    expect(fillerNoticeChance(0, 1)).toBe(0);
  });
});
