import { describe, expect, it } from "vitest";
import { FULL_PROFILE, type LifeOptions } from "../../game/index.ts";
import { runFullProfileSeed } from "./full-profile-run.ts";
import {
  NATALITY_GESTATION_DAYS,
  NATALITY_PROCESSES,
  NATALITY_RATE_SCALE,
  natalityLifeOptions,
} from "./natality-coverage.ts";

describe("cobertura dirigida de natalidad (perfil2c-natality)", () => {
  it("el ajuste solo acelera fecundidad y gestación, y no toca el perfil", () => {
    const next: LifeOptions = natalityLifeOptions(FULL_PROFILE);
    expect(next.conceptionRateScale).toBe(NATALITY_RATE_SCALE);
    expect(next.conceptionGestationDays).toBe(NATALITY_GESTATION_DAYS);
    const { conceptionRateScale: _a, conceptionGestationDays: _b, ...rest } = next;
    expect(rest).toEqual(FULL_PROFILE);
    expect(FULL_PROFILE).not.toHaveProperty("conceptionRateScale");
  });

  it("60 días de perfil completo ejercitan concepción, parto y nacimiento sin violar invariantes", () => {
    const report = runFullProfileSeed(1, {
      seeds: [1],
      years: 1,
      days: 60,
      checkEveryDays: 30,
      natality: true,
    });
    if (!("performance" in report)) throw new Error("la corrida falló");
    expect(report.problems).toEqual([]);
    for (const id of NATALITY_PROCESSES)
      expect(report.performance.processes[id]?.effectiveCalls ?? 0).toBeGreaterThan(0);
    expect(report.metrics.births).toBeGreaterThan(0);
  }, 180_000);
});
