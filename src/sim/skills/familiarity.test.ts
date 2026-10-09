import { describe, expect, it } from "vitest";
import {
  exposeTo,
  exposeToPerson,
  familiarityOf,
  familiarWith,
  rivalKey,
  styleKey,
} from "./state.ts";

const DAY = 86400;

describe("familiaridad", () => {
  it("sin exposición es cero", () => {
    expect(familiarityOf(undefined, rivalKey("a"), 0, DAY)).toBe(0);
  });

  it("sube con la exposición, sin pasar de 1, y solo con ese rival", () => {
    const once = exposeTo(undefined, rivalKey("a"), 0.5, 0, DAY);
    const twice = exposeTo(once, rivalKey("a"), 0.5, 0, DAY);
    const a1 = familiarityOf(once, rivalKey("a"), 0, DAY);
    const a2 = familiarityOf(twice, rivalKey("a"), 0, DAY);
    expect(a1).toBeGreaterThan(0);
    expect(a2).toBeGreaterThan(a1);
    expect(a2).toBeLessThan(1);
    expect(familiarityOf(twice, rivalKey("b"), 0, DAY)).toBe(0);
  });

  it("se olvida con el tiempo", () => {
    const s = exposeTo(undefined, rivalKey("a"), 2, 0, DAY);
    expect(familiarityOf(s, rivalKey("a"), 200 * DAY, DAY)).toBeLessThan(
      familiarityOf(s, rivalKey("a"), 0, DAY) / 4,
    );
  });
});

describe("familiaridad con el estilo", () => {
  it("conocer a una persona acostumbra también a su estilo, con menos peso", () => {
    const s = exposeToPerson(undefined, "a", "valle", 1, 0, DAY);
    const person = familiarityOf(s, rivalKey("a"), 0, DAY);
    const style = familiarityOf(s, styleKey("valle"), 0, DAY);
    expect(style).toBeGreaterThan(0);
    expect(style).toBeLessThan(person);
  });

  it("el estilo ayuda con alguien nuevo de la misma gente, no con otra", () => {
    const s = exposeToPerson(undefined, "a", "valle", 2, 0, DAY);
    expect(familiarWith(s, [rivalKey("b"), styleKey("valle")], 0, DAY)).toBeGreaterThan(0.3);
    expect(familiarWith(s, [rivalKey("b"), styleKey("costa")], 0, DAY)).toBe(0);
  });
});
