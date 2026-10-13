import { describe, expect, it } from "vitest";
import { GAME_CONTENT_KINDS, Life } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { runFullProfileSeed } from "./full-profile-run.ts";
import { livingHouseholds, rescueLoanSeeds } from "./rescue-coverage.ts";

describe("cobertura dirigida de rescate y préstamos (perfil2c-rescue-loans)", () => {
  it("las semillas salen de hogares vivos distintos con grano real y son deterministas", () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const life = Life.create(1, content, {});
    const seeds = rescueLoanSeeds(life);
    expect(seeds).toEqual(rescueLoanSeeds(life));
    const [seed] = seeds ?? [];
    if (!seed) throw new Error("sin semilla");
    const homes = livingHouseholds(life.world.truth);
    const parties = [
      seed.lender,
      seed.borrower,
      ...(seed.guarantors ?? []).map((g) => g.household),
    ];
    expect(new Set(parties).size).toBe(3);
    for (const p of parties) expect(homes).toContain(p);
    expect(seed.principal).toBeGreaterThan(0);
  }, 60_000);

  it("30 días de perfil completo ejercitan life.loans, life.pledge y life.hire sin violar invariantes", () => {
    const report = runFullProfileSeed(1, {
      seeds: [1],
      years: 1,
      days: 30,
      checkEveryDays: 30,
      rescue: true,
    });
    if (!("performance" in report)) throw new Error("la corrida falló");
    expect(report.problems).toEqual([]);
    for (const id of ["life.loans", "life.pledge", "life.hire"])
      expect(report.performance.processes[id]?.effectiveCalls ?? 0).toBeGreaterThan(0);
    expect(report.setup.life).toHaveProperty("loanSeeds");
  }, 180_000);
});
