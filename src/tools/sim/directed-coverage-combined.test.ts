import { describe, expect, it } from "vitest";
import { runFullProfileSeed } from "./full-profile-run.ts";

// perfil2-coverage-scenarios: los escenarios dirigidos del tooling (natalidad y rescate) combinados en
// una sola corrida de perfil completo, junto con los dormidos que el perfil ya activa. No toca la sim.
// El viaje NPC (`life.transit`) NO aparece en esta corrida: la espera por lluvia (`npcRainForecast`)
// consume la salida del recado antes de que venza la decisión (ROADMAP `perfil2-rain-wait-persist`);
// `transit-coverage.test.ts` lo cubre sin el pronóstico y `journey-coverage.test.ts` el cableado.
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
