import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import {
  exposureDose,
  immuneSusceptibility,
  immunityAfter,
  infectionChance,
  infectionStage,
  isImmune,
  type PathogenDef,
  sheddingLevel,
  tryInfect,
} from "./disease.ts";

const flu: PathogenDef = {
  id: "flu",
  routes: { air: 0.8, contact: 0.3 },
  incubationHours: 48,
  courseHours: 120,
  contagiousFrom: 0.5,
  transmissibility: 0.05,
  lethality: 0.1,
  immunity: "waning",
  immunityHours: 2000,
};

const room = { hours: 8, closeness: 0.6, ventilation: 0, waterDirt: 0, touch: 0.3 };

describe("susceptibilidad por carencia inmune", () => {
  it("1 = sin efecto; defensa débil sube la chance", () => {
    expect(immuneSusceptibility(1)).toBe(1);
    expect(infectionChance(flu, 5, 0, immuneSusceptibility(1))).toBe(infectionChance(flu, 5, 0));
    expect(infectionChance(flu, 5, 0, immuneSusceptibility(0.5))).toBeGreaterThan(
      infectionChance(flu, 5, 0),
    );
  });
});

describe("enfermedades con contagio", () => {
  it("el aire libre baja la dosis, la inmunidad baja la chance y el curso avanza", () => {
    const closed = exposureDose(flu, 1, room);
    const open = exposureDose(flu, 1, { ...room, ventilation: 1 });
    expect(open).toBeLessThan(closed);
    expect(exposureDose(flu, 0, room)).toBe(0);
    expect(infectionChance(flu, closed, 0.8)).toBeLessThan(infectionChance(flu, closed, 0));
    const inf = { pathogen: "flu", exposedAt: 0, dose: closed, fatal: false, cause: null };
    expect(infectionStage(flu, inf, 10)).toBe("incubating");
    expect(sheddingLevel(flu, "incubating", 10)).toBe(0);
    expect(infectionStage(flu, inf, 100)).toBe("symptomatic");
    expect(infectionStage(flu, inf, 200)).toBe("recovered");
    expect(infectionStage(flu, { ...inf, fatal: true }, 200)).toBe("dead");
    const imm = immunityAfter(flu, 60, 1000);
    expect(imm).not.toBeNull();
    expect(isImmune(imm ? [imm] : [], "flu", 1001)).toBe(true);
    expect(isImmune(imm ? [imm] : [], "flu", 1000 + 2000 * 60)).toBe(false);
  });

  it("la tirada es determinista con la misma clave", () => {
    const run = () => {
      const rng = Rng.root(7).fork("infect", 1, 2, 3);
      return tryInfect(flu, 4000, 0, 0.5, rng, 100, null);
    };
    expect(run()).toEqual(run());
    expect(run()).not.toBeNull();
  });
});
