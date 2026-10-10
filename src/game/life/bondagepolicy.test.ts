import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { SKILL_STATE, WorldTruth } from "../../sim/index.ts";
import { ABUSE_MAX_CHANCE, abuseChanceOf, skillWageOf } from "./bondagepolicy.ts";

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

describe("skillWageOf", () => {
  const who = "agent:1" as AgentId;
  const withLevel = (level: number) => {
    const truth = new WorldTruth();
    truth.set(SKILL_STATE, who, {
      smith: { facets: { execution: { level, peak: level } }, hours: 1, lastPracticed: null },
    });
    return truth;
  };
  const crafts = new Set(["smith"]);
  it("escala con el nivel del oficio y cae a la constante sin oficio", () => {
    expect(skillWageOf(new WorldTruth(), who, 100, crafts)).toBeUndefined();
    expect(skillWageOf(withLevel(0), who, 100, crafts)).toBeUndefined();
    const low = skillWageOf(withLevel(0.2), who, 100, crafts) ?? 0;
    const high = skillWageOf(withLevel(0.7), who, 100, crafts) ?? 0;
    expect(high).toBeGreaterThan(low);
    expect(skillWageOf(withLevel(0.7), who, 100, new Set(["other"]))).toBeUndefined();
  });
});
