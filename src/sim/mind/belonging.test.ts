import { describe, expect, it } from "vitest";
import {
  BELONGING_TUNING,
  type BelongingInputs,
  belongingProblems,
  belongingSources,
  belongingTarget,
  nextInDeficit,
  stepBelonging,
} from "./belonging.ts";

const base: BelongingInputs = {
  housemates: 4,
  spouseAlive: true,
  parentsAlive: 2,
  ageYears: 30,
  yearsInVillage: 10,
};

describe("pertenencia", () => {
  it("con casa, pareja y arraigo el objetivo es pleno", () => {
    expect(belongingTarget(belongingSources(base).sources)).toBe(1);
  });

  it("solo y recién llegado tiende a poco y deja la causa de aislamiento", () => {
    const r = belongingSources({
      ...base,
      housemates: 0,
      spouseAlive: false,
      parentsAlive: 0,
      yearsInVillage: 0,
    });
    expect(r.reasons).toContain("isolation");
    expect(belongingTarget(r.sources)).toBe(0);
  });

  it("niño sin padres vivos: orfandad; adulto igual no", () => {
    expect(belongingSources({ ...base, ageYears: 8, parentsAlive: 0 }).reasons).toContain("orphan");
    expect(belongingSources({ ...base, ageYears: 40, parentsAlive: 0 }).reasons).not.toContain(
      "orphan",
    );
  });

  it("el nivel se mueve despacio y no se pasa del objetivo", () => {
    expect(stepBelonging(1, 0, 1)).toBeCloseTo(1 - 1 / BELONGING_TUNING.settleDays);
    expect(stepBelonging(1, 0, 30)).toBeGreaterThan(0.6);
    expect(stepBelonging(0.5, 0.52, 30)).toBe(0.52);
    expect(stepBelonging(0, 1, BELONGING_TUNING.settleDays)).toBe(1);
  });

  it("el aviso de déficit tiene histéresis", () => {
    expect(nextInDeficit(false, 0.5)).toBe(false);
    expect(nextInDeficit(false, 0.4)).toBe(true);
    expect(nextInDeficit(true, 0.5)).toBe(true);
    expect(nextInDeficit(true, 0.7)).toBe(false);
  });

  it("detecta niveles fuera de rango", () => {
    const s = {
      level: 1.2,
      sources: [],
      reasons: [],
      inDeficit: false,
      updatedAt: 0,
      originEventId: "e1",
    } as never;
    expect(belongingProblems(s)).toHaveLength(1);
  });
});
