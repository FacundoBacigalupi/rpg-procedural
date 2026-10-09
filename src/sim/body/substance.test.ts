import { describe, expect, it } from "vitest";
import {
  CLEAN,
  craving,
  dose,
  effectLevel,
  poisonStage,
  type SubstanceDef,
  type SubstanceState,
  stepSubstance,
  substanceDeath,
  withdrawalSeverity,
} from "./substance.ts";

const OPIATE: SubstanceDef = {
  id: "opiate",
  routes: {
    ingest: { bioavailability: 0.5, halfHours: 1 },
    inhale: { bioavailability: 0.8, halfHours: 0.1 },
  },
  halfLifeHours: 4,
  ec50: 1,
  hill: 2,
  latencyHours: 2,
  toxicThreshold: 20,
  damagePerHourAtDouble: 0.2,
  repairHalfHours: 24,
  dependence: {
    potential: 0.15,
    tolerancePerUse: 0.1,
    withdrawalOnsetHours: 8,
    withdrawalPeakHours: 48,
    recoveryHalfDays: 20,
  },
};

const POISON: SubstanceDef = {
  id: "slow-poison",
  routes: { ingest: { bioavailability: 0.9, halfHours: 2 } },
  halfLifeHours: 12,
  ec50: 5,
  hill: 1,
  latencyHours: 12,
  toxicThreshold: 4,
  damagePerHourAtDouble: 0.12,
  repairHalfHours: 48,
};

function run(def: SubstanceDef, s: SubstanceState, hours: number): SubstanceState {
  let cur = s;
  for (let i = 0; i < hours; i++) cur = stepSubstance(def, cur, 1);
  return cur;
}

describe("substance", () => {
  it("sin sustancia no hace nada y una vía no listada no entra", () => {
    expect(run(OPIATE, CLEAN, 48)).toEqual({ ...CLEAN, hoursSinceUse: Number.POSITIVE_INFINITY });
    expect(dose(OPIATE, CLEAN, "skin", 5)).toBe(CLEAN);
    expect(effectLevel(OPIATE, CLEAN)).toBe(0);
  });

  it("la vía cambia la rapidez: inhalada pega antes que ingerida", () => {
    const eaten = run(OPIATE, dose(OPIATE, CLEAN, "ingest", 4), 1);
    const smoked = run(OPIATE, dose(OPIATE, CLEAN, "inhale", 4), 1);
    expect(smoked.blood).toBeGreaterThan(eaten.blood);
  });

  it("el efecto sube con la dosis y la sangre se metaboliza", () => {
    const low = run(OPIATE, dose(OPIATE, CLEAN, "ingest", 2), 2);
    const high = run(OPIATE, dose(OPIATE, CLEAN, "ingest", 8), 2);
    expect(effectLevel(OPIATE, high)).toBeGreaterThan(effectLevel(OPIATE, low));
    const later = run(OPIATE, high, 48);
    expect(later.blood).toBeLessThan(high.blood / 100);
  });

  it("la tolerancia baja el efecto de la misma dosis y la abstinencia aparece tras el uso repetido", () => {
    let s: SubstanceState = CLEAN;
    const first = effectLevel(OPIATE, run(OPIATE, dose(OPIATE, s, "ingest", 4), 1));
    for (let i = 0; i < 10; i++) s = run(OPIATE, dose(OPIATE, s, "ingest", 4), 12);
    const again = effectLevel(OPIATE, run(OPIATE, dose(OPIATE, s, "ingest", 4), 1));
    expect(again).toBeLessThan(first);
    expect(s.dependence).toBeGreaterThan(0.5);
    const early = run(OPIATE, s, 6);
    expect(withdrawalSeverity(OPIATE, early)).toBe(0);
    const late = run(OPIATE, s, 60);
    expect(withdrawalSeverity(OPIATE, late)).toBeGreaterThan(0.3);
    expect(craving(OPIATE, late)).toBeGreaterThan(craving(OPIATE, CLEAN));
    // Con una dosis la abstinencia cede.
    expect(withdrawalSeverity(OPIATE, dose(OPIATE, late, "inhale", 4))).toBe(0);
    // Pasadas semanas la dependencia se va.
    expect(run(OPIATE, late, 24 * 60).dependence).toBeLessThan(0.1);
  });

  it("un veneno lento actúa con latencia y una dosis letal mata; una baja se repara", () => {
    const hit = dose(POISON, CLEAN, "ingest", 80);
    const early = run(POISON, hit, 3);
    expect(poisonStage(early)).toBe("none");
    const mid = run(POISON, hit, 24);
    expect(mid.damage).toBeGreaterThan(early.damage);
    const dead = run(POISON, hit, 72);
    expect(substanceDeath(dead)).toBe(true);

    const small = run(POISON, dose(POISON, CLEAN, "ingest", 3), 200);
    expect(small.damage).toBe(0);
  });

  it("es determinista", () => {
    const a = run(OPIATE, dose(OPIATE, CLEAN, "ingest", 6), 30);
    const b = run(OPIATE, dose(OPIATE, CLEAN, "ingest", 6), 30);
    expect(a).toEqual(b);
  });
});
