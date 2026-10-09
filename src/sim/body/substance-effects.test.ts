import { describe, expect, it } from "vitest";
import {
  type AcuteEffects,
  acuteEffects,
  applyAcute,
  type BodyCapabilities,
  CLEAN,
  dose,
  NEUTRAL,
  type SubstanceDef,
  stepSubstance,
  substanceSigns,
} from "../index.ts";
import { needsFrom } from "../mind/index.ts";

const OPIATE: SubstanceDef = {
  id: "poppy",
  routes: { ingest: { bioavailability: 0.8, halfHours: 1 } },
  halfLifeHours: 4,
  ec50: 2,
  hill: 1.5,
  latencyHours: 2,
  toxicThreshold: Number.POSITIVE_INFINITY,
  damagePerHourAtDouble: 0,
  repairHalfHours: 24,
  dependence: {
    potential: 0.5,
    tolerancePerUse: 0.1,
    withdrawalOnsetHours: 6,
    withdrawalPeakHours: 24,
    recoveryHalfDays: 20,
  },
  acute: { impairs: { cognition: 0.5 }, numbs: 0.9, withdrawalImpairs: { manipulation: 0.4 } },
};

const caps: BodyCapabilities = {
  locomotion: 1,
  manipulation: 1,
  speech: 1,
  strength: 1,
  cognition: 1,
  endurance: 1,
  sight: 1,
  hearing: 1,
};

function hours(s: ReturnType<typeof dose>, n: number) {
  let x = s;
  for (let i = 0; i < n; i++) x = stepSubstance(OPIATE, x, 1);
  return x;
}

describe("efectos agudos de sustancias", () => {
  it("sin sustancias no cambia nada", () => {
    expect(acuteEffects([])).toBe(NEUTRAL);
    expect(applyAcute(caps, NEUTRAL)).toBe(caps);
  });

  it("con la sustancia en sangre nubla la mente y alivia el dolor", () => {
    let s = dose(OPIATE, CLEAN, "ingest", 6);
    s = hours(s, 3);
    const fx = acuteEffects([{ def: OPIATE, state: s }]);
    expect(fx.impair.cognition ?? 0).toBeGreaterThan(0.1);
    expect(fx.numbing).toBeGreaterThan(0.3);
    expect(applyAcute(caps, fx).cognition).toBeLessThan(0.9);
    expect(substanceSigns([{ def: OPIATE, state: s }]).map((x) => x.kind)).toContain("sedated");
  });

  it("la abstinencia tiembla las manos, deja ansia y empuja la necesidad", () => {
    let s = dose(OPIATE, CLEAN, "ingest", 6);
    for (let i = 0; i < 4; i++) s = dose(OPIATE, hours(s, 12), "ingest", 6);
    s = hours(s, 60);
    const fx: AcuteEffects = acuteEffects([{ def: OPIATE, state: s }]);
    expect(fx.withdrawal).toBeGreaterThan(0.1);
    expect(fx.impair.manipulation ?? 0).toBeGreaterThan(0);
    expect(fx.craving).toBeGreaterThan(fx.withdrawal * 0.9);
    const plan = { physiology: { refMassKg: 70, glycogenKcal: 400, fatFraction: 0.2 } } as never;
    const body = {
      massKg: 70,
      glycogen: 400,
      fat: (14000 * 7700) / 1000,
      water: 0,
      sleepDebt: 0,
      fatigue: 0,
      wounds: [],
      sepsis: 0,
    } as never;
    expect(needsFrom(plan, body, { craving: fx.craving }).craving).toBe(fx.craving);
    expect(needsFrom(plan, body).craving).toBeUndefined();
  });
});
