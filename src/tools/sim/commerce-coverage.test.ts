import { describe, expect, it } from "vitest";
import { FULL_PROFILE } from "../../game/index.ts";
import { COMMERCE_PROCESSES, commerceLifeOptions } from "./commerce-coverage.ts";
import { runFullProfileSeed } from "./full-profile-run.ts";

describe("cobertura dirigida de oficios vistos y profecías (perfil2c-encounters-trade)", () => {
  it("el ajuste solo suma fromSeed a la vista de oficios y no toca el perfil", () => {
    const next = commerceLifeOptions(FULL_PROFILE);
    expect(next.tradeView).toEqual({ ...FULL_PROFILE.tradeView, fromSeed: true });
    expect({ ...next, tradeView: FULL_PROFILE.tradeView }).toEqual(FULL_PROFILE);
    expect(FULL_PROFILE.tradeView).not.toHaveProperty("fromSeed");
  });

  it("10 días de perfil completo ejercitan life.trade_view y life.retold sin violar invariantes", () => {
    const report = runFullProfileSeed(1, {
      seeds: [1],
      years: 1,
      days: 10,
      checkEveryDays: 10,
      commerce: true,
    });
    if (!("performance" in report)) throw new Error("la corrida falló");
    expect(report.problems).toEqual([]);
    for (const id of COMMERCE_PROCESSES)
      expect(report.performance.processes[id]?.effectiveCalls ?? 0).toBeGreaterThan(0);
  }, 180_000);
});
