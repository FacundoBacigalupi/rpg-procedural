import { describe, expect, it } from "vitest";
import { cueCraving, learnCues, pruneCues } from "./substance-cues.ts";

const DAY = 1000;
const HALF = 60 * DAY;
const place = { hex: 7, people: ["agent:2"], hour: 21 };

describe("señales de ansia", () => {
  it("sin señales no hay ansia", () => {
    expect(cueCraving([], place, 0, HALF)).toBe(0);
  });

  it("aprende del entorno donde tomó, despierta ansia solo allí y se extingue", () => {
    let cues = learnCues([], "wine", place, 0, HALF);
    expect(cueCraving(cues, place, 0, HALF)).toBeGreaterThan(0);
    const elsewhere = { hex: 9, people: [], hour: 9 };
    expect(cueCraving(cues, elsewhere, 0, HALF)).toBe(0);
    // Reforzar sube; el techo se respeta.
    for (let i = 0; i < 40; i++) cues = learnCues(cues, "wine", place, 0, HALF);
    expect(cues.every((c) => c.strength <= 0.6)).toBe(true);
    const later = cueCraving(cues, place, 10 * HALF, HALF);
    expect(later).toBeLessThan(cueCraving(cues, place, 0, HALF) / 100);
    expect(pruneCues(cues, 10 * HALF, HALF)).toHaveLength(0);
  });
});
