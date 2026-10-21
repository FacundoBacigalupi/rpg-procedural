import { describe, expect, it } from "vitest";
import { runFullProfileSeed } from "./full-profile-run.ts";

// perfil2-coverage-scenarios: los escenarios dirigidos del tooling (natalidad y rescate) combinados en
// una sola corrida de perfil completo, junto con los dormidos que el perfil ya activa. No toca la sim.
// El viaje NPC se cubre con el perfil completo en `transit-coverage.test.ts` (corrida aparte) y el
// cableado en `journey-coverage.test.ts`.
describe("cobertura dirigida combinada con el perfil completo (perfil2-coverage-scenarios)", () => {
  it("dormidos, embarazo/parto y préstamos ejercen sus procesos en la misma corrida", () => {
    const report = runFullProfileSeed(1, {
      seeds: [1],
      years: 1,
      days: 45,
      checkEveryDays: 15,
      natality: true,
      rescue: true,
    });
    if (!("performance" in report)) throw new Error("la corrida falló");
    expect(report.problems).toEqual([]);
    const calls = (id: string) => report.performance.processes[id]?.effectiveCalls ?? 0;
    for (const id of [
      "life.catch_up_wake",
      "life.catch_up_daily",
      "life.conception",
      "life.labor",
      "life.birth",
      "life.loans",
      "life.pledge",
      "life.hire",
    ])
      expect(calls(id), id).toBeGreaterThan(0);
    expect(report.metrics.births).toBeGreaterThan(0);
  }, 300_000);
});
