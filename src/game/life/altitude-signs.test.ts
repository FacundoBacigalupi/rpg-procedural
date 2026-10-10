import { describe, expect, it } from "vitest";
import { adaptationRate, altitudeSickness, stepAcclimatization } from "../../sim/index.ts";
import { signsOfAltitude } from "./medicine.ts";

describe("mal de altura: signos del sanador y adaptación", () => {
  it("los signos crecen con la severidad y sin mal no hay ninguno", () => {
    expect(signsOfAltitude("none")).toEqual({});
    const mild = signsOfAltitude("mild");
    const severe = signsOfAltitude("severe");
    expect(severe["headache"] ?? 0).toBeGreaterThan(mild["headache"] ?? 0);
    expect(severe["confusion"]).toBeGreaterThan(0);
    // 8000 m sin aclimatar es grave; aclimatado del todo baja.
    expect(altitudeSickness(8000, 0)).toBe("severe");
    expect(altitudeSickness(8000, 1)).not.toBe("severe");
  });

  it("la constitución heredada acelera la aclimatación, acotada y determinista", () => {
    expect(adaptationRate(undefined)).toBe(1);
    expect(adaptationRate(10)).toBe(1.3);
    expect(adaptationRate(-10)).toBe(0.7);
    const slow = stepAcclimatization(0, 4500, 2, adaptationRate(-2));
    const base = stepAcclimatization(0, 4500, 2);
    const fast = stepAcclimatization(0, 4500, 2, adaptationRate(2));
    expect(slow).toBeLessThan(base);
    expect(fast).toBeGreaterThan(base);
    expect(stepAcclimatization(0, 4500, 2, adaptationRate(2))).toBe(fast);
  });
});
