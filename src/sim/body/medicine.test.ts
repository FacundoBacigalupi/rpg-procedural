import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import type { PathogenDef } from "./disease.ts";
import {
  birthRisk,
  type ConditionModel,
  diagnose,
  placeboComfort,
  quarantinedShared,
  type RemedyDef,
  remedyEffect,
  remedyHarm,
  resolveBirth,
  treatedFatalChance,
  windowCurve,
  woundInfectionRisk,
} from "./medicine.ts";

const flu: PathogenDef = {
  id: "flu",
  routes: { air: 0.8 },
  incubationHours: 48,
  courseHours: 100,
  contagiousFrom: 0.5,
  transmissibility: 0.05,
  lethality: 0.2,
  immunity: "waning",
  immunityHours: 2000,
};
const tea: RemedyDef = {
  id: "tea",
  targets: ["flu"],
  onsetHours: 2,
  peakHours: 8,
  endHours: 24,
  potency: 0.8,
  optimalDose: 2,
  toxicDose: 6,
  placebo: 0.3,
};
const sham: RemedyDef = { ...tea, id: "sham", targets: [] };
const given = (r: RemedyDef, over = {}) => ({
  remedy: r,
  dose: 2,
  hoursSinceDose: 8,
  courseHoursAtDose: 0,
  skill: 1,
  ...over,
});

const models: ConditionModel[] = [
  { id: "flu", signature: { fever: 1, cough: 0.8 }, prior: 0 },
  { id: "poison", signature: { vomit: 1, pallor: 0.6 }, prior: 0 },
  { id: "fire-imbalance", signature: { fever: 1 }, prior: 1 },
];

describe("medicina", () => {
  it("diagnóstico determinista; el hábil acierta más y el sesgo cultural confunde al novato", () => {
    const signs = { fever: 0.9, cough: 0.8 };
    const a = diagnose(signs, models, 0.5, 0.5, Rng.root(1).fork("t"));
    const b = diagnose(signs, models, 0.5, 0.5, Rng.root(1).fork("t"));
    expect(a).toEqual(b);
    let skilled = 0;
    let novice = 0;
    for (let i = 0; i < 200; i++) {
      if (diagnose(signs, models, 0.95, 0.9, Rng.root(i).fork("t"))?.condition === "flu") skilled++;
      if (diagnose(signs, models, 0, 0, Rng.root(i).fork("t"))?.condition === "flu") novice++;
    }
    expect(skilled).toBeGreaterThan(novice);
    expect(skilled).toBeGreaterThan(140);
    expect(diagnose(signs, [], 1, 1, Rng.root(1).fork("t"))).toBeNull();
  });

  it("el remedio tiene ventana y dosis; el que no es para el patógeno no hace nada", () => {
    expect(windowCurve(tea, 1)).toBe(0);
    expect(windowCurve(tea, 8)).toBe(1);
    expect(windowCurve(tea, 30)).toBe(0);
    expect(remedyEffect(flu, given(tea))).toBeGreaterThan(0.5);
    expect(remedyEffect(flu, given(tea, { courseHoursAtDose: 90 }))).toBeLessThan(
      remedyEffect(flu, given(tea)),
    );
    expect(remedyEffect(flu, given(tea, { dose: 6 }))).toBe(0);
    expect(remedyHarm(tea, 6)).toBe(1);
    expect(remedyEffect(flu, given(sham))).toBe(0);
    expect(placeboComfort(given(sham), 1)).toBeGreaterThan(0);
    expect(placeboComfort(given(sham), 1)).toBeLessThanOrEqual(0.3);
  });

  it("tratar baja la letalidad pero no la anula; sobredosis la sube", () => {
    const base = treatedFatalChance(flu, 0.5, 0, 0);
    const treated = treatedFatalChance(flu, 0.5, remedyEffect(flu, given(tea)), 0);
    expect(treated).toBeLessThan(base);
    expect(treated).toBeGreaterThan(0);
    expect(treatedFatalChance(flu, 0.5, 0, 1)).toBeGreaterThan(base);
    expect(woundInfectionRisk(0.3, true, true, 1)).toBeLessThan(
      woundInfectionRisk(0.3, false, false, 1),
    );
  });

  it("la cuarentena baja lo que comparten los demás y poco lo del cuidador", () => {
    const sh = { hours: 8, closeness: 0.6, ventilation: 0, waterDirt: 0.4, touch: 0.3 };
    const q = { isolation: 1, compliance: 0.8, caregiverHygiene: 1, separateWater: true };
    const out = quarantinedShared(sh, q, false);
    expect(out.hours).toBeLessThan(sh.hours);
    expect(out.waterDirt).toBeLessThan(sh.waterDirt);
    const care = quarantinedShared(sh, q, true);
    expect(care.hours).toBe(sh.hours);
    expect(care.touch).toBeLessThan(sh.touch);
  });

  it("la partera y la higiene bajan el riesgo del parto", () => {
    const b = {
      motherAgeYears: 17,
      nutrition: 0.5,
      health: 0.6,
      parity: 0,
      midwifeSkill: null,
      hygiene: 0.2,
      supplies: 0,
      difficulty: 0.3,
    };
    const alone = birthRisk(b);
    const aided = birthRisk({ ...b, midwifeSkill: 0.9, hygiene: 0.9, supplies: 0.8 });
    expect(aided.complication).toBeLessThan(alone.complication);
    expect(aided.maternalDeathIfComplication).toBeLessThan(alone.maternalDeathIfComplication);
    expect(aided.puerperalFever).toBeLessThan(alone.puerperalFever);
    expect(resolveBirth(alone, Rng.root(5).fork("t"))).toEqual(
      resolveBirth(alone, Rng.root(5).fork("t")),
    );
  });
});
