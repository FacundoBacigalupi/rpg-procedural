import { describe, expect, it } from "vitest";
import {
  airCAtAltitude,
  altitudeEnv,
  type Clothing,
  CORE_NORMAL_C,
  dexterityFactor,
  dressed,
  fireRadiantC,
  frostbiteAmputations,
  frostbiteHandFactor,
  frostbitePerHour,
  frostbiteStage,
  heatLossW,
  NAKED,
  NO_FROSTBITE,
  relativePressure,
  shelterOf,
  shelterOfSpace,
  stepCore,
  stepFrostbite,
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

describe("escala por masa, ropa puesta, fuego y refugio", () => {
  const stepsOf = (kg: number, env: ThermalEnv, c: Clothing, hours: number) => {
    let core = CORE_NORMAL_C;
    for (let h = 0; h < hours * 4; h++) core = stepCore(core, kg, env, c, 1, 1, 0.25).coreC;
    return core;
  };
  it("un bebé abrigado en un día templado no se desvía ni muere de calor", () => {
    const core = stepsOf(4, TEMPERATE, street, 24);
    expect(core).toBeGreaterThan(36);
    expect(core).toBeLessThan(38.5);
    expect(thermalDeath(core)).toBeNull();
  });
  it("un bebé en el frío cae más rápido que un adulto", () => {
    const cold = { ...TEMPERATE, airC: -5, windMs: 4 };
    expect(stepsOf(4, cold, street, 2)).toBeLessThan(stepsOf(70, cold, street, 2));
  });
  it("sobre la masa de referencia nada cambia", () => {
    expect(heatLossW(TEMPERATE, street, 70)).toBe(heatLossW(TEMPERATE, street, 90));
  });
  it("dressed suma aislamiento, toma el mejor cortaviento y superpone la cobertura", () => {
    const c = dressed([
      { clo: 0.6, windproof: 0.1, coverage: 0.7 },
      { clo: 1.5, windproof: 0.7, coverage: 0.5 },
    ]);
    expect(c.clo).toBeCloseTo(2.1);
    expect(c.windproof).toBe(0.7);
    expect(c.coverage).toBeCloseTo(0.85);
    expect(dressed([]).clo).toBe(0);
  });
  it("el fuego calienta más cerca y no llega lejos; el techo repara más que el campo", () => {
    expect(fireRadiantC([{ intensity: 1, distanceM: 2 }])).toBeGreaterThan(
      fireRadiantC([{ intensity: 1, distanceM: 6 }]),
    );
    expect(fireRadiantC([{ intensity: 1, distanceM: 30 }])).toBe(0);
    expect(shelterOf(true, 0)).toBe(1);
    expect(shelterOf(true, 1)).toBeLessThan(shelterOf(true, 0));
    expect(shelterOf(false, 1)).toBe(0);
  });
  it("la congelación se acumula con el frío, más con el núcleo frío, y termina en amputación", () => {
    const cold = { ...TEMPERATE, airC: -25, windMs: 5 };
    let warm = NO_FROSTBITE;
    let chilled = NO_FROSTBITE;
    for (let h = 0; h < 6; h++) {
      warm = stepFrostbite(warm, cold, street, 37, 1, h);
      chilled = stepFrostbite(chilled, cold, street, 33, 1, h);
    }
    expect(chilled.hands).toBeGreaterThan(warm.hands);
    expect(frostbiteHandFactor(chilled)).toBeLessThan(1);
    let s = NO_FROSTBITE;
    for (let h = 0; h < 40; h++) s = stepFrostbite(s, cold, NAKED, 33, 1, h);
    expect(frostbiteStage(s.hands)).toBe("necrotic");
    expect(frostbiteAmputations(s)).toContain("hands");
    expect(stepFrostbite(s, TEMPERATE, street, 37, 10, 50).hands).toBe(s.hands);
  });
  it("sin frío no hay congelación y lo leve se cura", () => {
    expect(stepFrostbite(NO_FROSTBITE, TEMPERATE, street, 37, 24, 1)).toEqual({
      ...NO_FROSTBITE,
      at: 1,
    });
    const hurt = { ...NO_FROSTBITE, hands: 0.3 };
    expect(stepFrostbite(hurt, TEMPERATE, street, 37, 10, 2).hands).toBeLessThan(0.3);
  });
});

describe("esfuerzo y sudor", () => {
  it("el esfuerzo calienta más y suda más que el reposo con calor", () => {
    const hot = { ...TEMPERATE, airC: 34, humidity: 0.3 };
    const rest = stepCore(CORE_NORMAL_C, 70, hot, street, 1, 1, 1);
    const heavy = stepCore(CORE_NORMAL_C, 70, hot, street, 3.4 / 1.2, 1, 1);
    expect(heavy.sweatL).toBeGreaterThan(rest.sweatL);
    expect(heavy.producedW).toBeGreaterThan(rest.producedW);
  });
});

describe("altitud y ambiente de qi", () => {
  it("el aire se enfría con la altura y la presión cae", () => {
    expect(airCAtAltitude(18, 0, 3000)).toBeCloseTo(18 - 19.5, 5);
    expect(relativePressure(0)).toBeCloseTo(1, 5);
    expect(relativePressure(5000)).toBeLessThan(0.6);
  });
  it("sin diferencia de altura ni qi devuelve el mismo ambiente", () => {
    expect(altitudeEnv(TEMPERATE, 300, 300)).toBe(TEMPERATE);
  });
  it("en la altura se pierde más calor y el qi frío agrava", () => {
    const high = altitudeEnv(TEMPERATE, 0, 3000);
    const qi = altitudeEnv(TEMPERATE, 0, 0, -10);
    expect(heatLossW(high, street)).toBeGreaterThan(heatLossW(TEMPERATE, street));
    expect(heatLossW(qi, street)).toBeGreaterThan(heatLossW(TEMPERATE, street));
    expect(altitudeEnv(TEMPERATE, 0, 3000, 0, 0.1).airC).toBeGreaterThan(high.airC);
  });
});

describe("reparo del espacio", () => {
  it("puerta cerrada abriga más que abierta, la piedra más que el papel, y sin techo menos", () => {
    const closed = shelterOfSpace({ roof: true, openness: 0, wall: "stone" });
    const open = shelterOfSpace({ roof: true, openness: 1, wall: "stone" });
    expect(closed).toBeGreaterThan(open);
    expect(shelterOfSpace({ roof: true, openness: 0, wall: "paper" })).toBeLessThan(closed);
    expect(shelterOfSpace({ roof: false, openness: 0, wall: "stone" })).toBeLessThanOrEqual(0.5);
    expect(shelterOfSpace({ roof: true, openness: 0 })).toBe(1);
  });
});
