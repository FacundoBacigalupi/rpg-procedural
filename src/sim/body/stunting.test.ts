import { describe, expect, it } from "vitest";
import { NO_DEFICIENCY } from "./nutrition.ts";
import {
  cognitionFactor,
  growthSensitivity,
  hasSequelae,
  heightFactor,
  MAX_STUNT,
  NO_SEQUELAE,
  stepSequelae,
} from "./stunting.ts";

const hungry = { growth: 0.4, cognition: 0.6 };

describe("secuelas de hambre infantil", () => {
  it("sin carencia no se acumula nada, a ninguna edad", () => {
    for (const age of [0, 2, 8, 15, 30]) {
      expect(stepSequelae(NO_SEQUELAE, age, NO_DEFICIENCY, 365)).toBe(NO_SEQUELAE);
    }
  });

  it("el hambre de bebé marca más que la de niño y la de adulto no marca", () => {
    const baby = stepSequelae(NO_SEQUELAE, 1, hungry, 200);
    const kid = stepSequelae(NO_SEQUELAE, 9, hungry, 200);
    expect(baby.stunt).toBeGreaterThan(kid.stunt);
    expect(baby.cognitiveLoss).toBeGreaterThan(0);
    expect(kid.cognitiveLoss).toBe(0);
    expect(hasSequelae(stepSequelae(NO_SEQUELAE, 30, hungry, 999))).toBe(false);
    expect(growthSensitivity(18)).toBe(0);
  });

  it("es permanente (no baja) y tiene techo", () => {
    let s = NO_SEQUELAE;
    for (let i = 0; i < 40; i++) s = stepSequelae(s, 1, { growth: 0, cognition: 0 }, 365);
    expect(s.stunt).toBe(MAX_STUNT);
    expect(heightFactor(s)).toBeCloseTo(1 - MAX_STUNT);
    expect(cognitionFactor(s)).toBeLessThan(1);
    expect(stepSequelae(s, 10, NO_DEFICIENCY, 365)).toEqual(s);
  });

  it("sin secuela los factores son neutros", () => {
    expect(heightFactor(NO_SEQUELAE)).toBe(1);
    expect(cognitionFactor(NO_SEQUELAE)).toBe(1);
  });
});
