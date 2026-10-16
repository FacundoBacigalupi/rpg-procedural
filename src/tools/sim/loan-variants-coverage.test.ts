import { describe, expect, it } from "vitest";
import { runFullProfileSeed } from "./full-profile-run.ts";

// perfil2-coverage-loan-variants: contagio, workout y rescate efectivo de préstamos en la misma corrida de
// perfil completo, con los hogares y proveedores reales del foco de salud y deuda (`focus`) más los préstamos
// sembrados de `rescue`. La corrida chequea invariantes (conservación incluida) cada 15 días y no debe
// reportar problemas. Solo tooling: no toca la sim ni los hashes.
describe("cobertura dirigida de variantes de préstamo (perfil2-coverage-loan-variants)", () => {
  it("contagio, workout, préstamos, prenda y contratación ejercen sus procesos sin violar invariantes", () => {
    const report = runFullProfileSeed(1, {
      seeds: [1],
      years: 1,
      days: 45,
      checkEveryDays: 15,
      focus: true,
      rescue: true,
    });
    if (!("performance" in report)) throw new Error("la corrida falló");
    expect(report.problems).toEqual([]);
    const calls = (id: string) => report.performance.processes[id]?.effectiveCalls ?? 0;
    for (const id of ["life.loans", "life.pledge", "life.hire", "life.workout", "life.contagion"])
      expect(calls(id), id).toBeGreaterThan(0);
  }, 300_000);
});
