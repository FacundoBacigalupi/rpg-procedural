import { describe, expect, it } from "vitest";
import {
  type Clothing,
  CORE_NORMAL_C,
  dexterityFactor,
  frostbitePerHour,
  stepCore,
  TEMPERATE,
  type ThermalEnv,
  thermalDeath,
  thermalStage,
} from "./thermal.ts";

const street: Clothing = { clo: 1, windproof: 0.2, coverage: 0.8 };
const parka: Clothing = { clo: 3.5, windproof: 0.8, coverage: 1 };

function run(env: ThermalEnv, c: Clothing, kcal: number, hours: number, water = 1) {
  let core = CORE_NORMAL_C;
  for (let h = 0; h < hours; h++) core = stepCore(core, 70, env, c, kcal, water, 1).coreC;
  return core;
}

describe("balance térmico", () => {
  it("en un día templado vestido, el núcleo no se mueve", () => {
    const core = run(TEMPERATE, street, 1.2, 24);
    expect(core).toBeGreaterThan(36.5);
    expect(core).toBeLessThan(37.6);
  });
  it("el frío, el viento y el mojado enfrían; la parka y el refugio protegen", () => {
    const cold = { ...TEMPERATE, airC: -10, windMs: 8, wet: 0.8 };
    const bad = run(cold, street, 1.2, 8);
    expect(thermalStage(bad)).not.toBe("normal");
    expect(dexterityFactor(bad)).toBeLessThan(1);
    expect(run({ ...cold, wet: 0, shelter: 0.9 }, parka, 1.2, 8)).toBeGreaterThan(bad);
    expect(frostbitePerHour(cold, street)).toBeGreaterThan(frostbitePerHour(cold, parka));
  });
  it("el esfuerzo con armadura en el desierto da golpe de calor; con sed, peor", () => {
    const desert = { ...TEMPERATE, airC: 42, windMs: 0, humidity: 0.2 };
    const armor: Clothing = { clo: 2, windproof: 0.5, coverage: 1 };
    const hot = run(desert, armor, 3.4, 4);
    expect(thermalStage(hot)).toBe("heatstroke");
    expect(run(desert, armor, 3.4, 4, 0.2)).toBeGreaterThanOrEqual(hot);
    expect(thermalDeath(27)).toBe("hypothermia");
    expect(thermalDeath(43)).toBe("heatstroke");
    expect(thermalDeath(37)).toBeNull();
  });
});
