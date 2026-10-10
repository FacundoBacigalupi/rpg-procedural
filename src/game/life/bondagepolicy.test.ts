import { describe, expect, it } from "vitest";
import { ABUSE_MAX_CHANCE, abuseChanceOf } from "./bondagepolicy.ts";

const base = { honesty: 0.2, boldness: 0.5, need: 0.5, restraint: 0 };

describe("abuseChanceOf", () => {
  it("el honesto no abusa y el tope se respeta", () => {
    expect(abuseChanceOf({ ...base, honesty: 1 })).toBe(0);
    expect(abuseChanceOf({ honesty: 0, boldness: 1, need: 1, restraint: 0 })).toBeLessThanOrEqual(
      ABUSE_MAX_CHANCE,
    );
  });
  it("es monótona en necesidad, audacia, honestidad y freno cultural", () => {
    const c = abuseChanceOf(base);
    expect(c).toBeGreaterThan(0);
    expect(abuseChanceOf({ ...base, need: 1 })).toBeGreaterThanOrEqual(c);
    expect(abuseChanceOf({ ...base, boldness: 1 })).toBeGreaterThanOrEqual(c);
    expect(abuseChanceOf({ ...base, honesty: 0.4 })).toBeLessThanOrEqual(c);
    expect(abuseChanceOf({ ...base, restraint: 0.6 })).toBeLessThanOrEqual(c);
  });
});
