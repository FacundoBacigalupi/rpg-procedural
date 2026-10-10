import { describe, expect, it } from "vitest";
import {
  cultivationEfficiency,
  deviationRisk,
  overload,
  purgeDays,
  splitByPurity,
  stepResidue,
} from "./residue.ts";

describe("residuos de la Essence", () => {
  it("reparte la ingesta por pureza sin perder nada", () => {
    const s = splitByPurity(100, 0.8);
    expect(s.residue).toBeCloseTo(20, 9);
    expect(s.useful + s.residue).toBeCloseTo(100, 9);
    expect(splitByPurity(100, 1).residue).toBe(0);
  });

  it("se purga con el tiempo, más rápido con recursos, y no pasa de cero", () => {
    expect(stepResidue(10, 10, 100).load).toBeCloseTo(0, 9);
    const fast = stepResidue(50, 1, 100, { ratePerDay: 0.2, costPerUnit: 2 });
    expect(fast.purged).toBe(20);
    expect(fast.cost).toBe(40);
    expect(purgeDays(50, 100)).toBe(25);
  });

  it("el residuo baja la eficiencia y sube el riesgo de desviación", () => {
    expect(cultivationEfficiency(0, 100)).toBe(1);
    expect(cultivationEfficiency(100, 100)).toBeLessThan(cultivationEfficiency(30, 100));
    expect(deviationRisk(40, 100, 0.5)).toBe(0);
    expect(deviationRisk(150, 100, 0.2)).toBeGreaterThan(deviationRisk(150, 100, 0.9));
  });

  it("el mortal que come de más: fiebre, meridianos quemados o muerte, conservando la Essence", () => {
    const body = { capacity: 10, affinity: 0.2 };
    expect(overload(body, 10).stage).toBe("none");
    expect(overload(body, 15).stage).toBe("fever");
    const burned = overload(body, 20);
    expect(burned.stage).toBe("burned");
    expect(burned.meridianDamage).toBeGreaterThan(0);
    expect(overload(body, 100).stage).toBe("fatal");
    for (const x of [5, 15, 20, 100]) {
      const r = overload(body, x);
      expect(r.absorbed + r.dissipated).toBeCloseTo(x, 9);
    }
  });

  it("despierta según el cuerpo, no la suerte", () => {
    expect(overload({ capacity: 10, affinity: 0.9 }, 25).awakens).toBe(true);
    expect(overload({ capacity: 10, affinity: 0.1 }, 15).awakens).toBe(false);
  });
});
