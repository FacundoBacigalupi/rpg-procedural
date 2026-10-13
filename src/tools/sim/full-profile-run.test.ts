import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullProfileProgress } from "./full-profile.ts";
import { runFullProfileBatch, runFullProfileSeed } from "./full-profile-run.ts";

vi.mock("node:child_process", () => ({ spawnSync: () => ({ status: null, signal: "SIGKILL" }) }));
vi.mock("../../persistence/index.ts", () => ({
  loadContentDir: () => ({
    hash: "test-content",
    get: (kind: { name: string }, id: string) => {
      if (kind.name !== "demography" || id !== "human.preindustrial-village") {
        throw new Error("unexpected coverage content query");
      }
      if (behavior.mode === "coverage-initial-error") throw new Error("coverage input crash");
      return {
        fertility: [
          { fromAge: 15, rate: 0.2 },
          { fromAge: 50, rate: 0 },
        ],
      };
    },
  }),
}));
const behavior = vi.hoisted(() => ({ mode: "create-error", checks: 0 }));
vi.mock("../../sim/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sim/index.ts")>()),
  checkInvariants: () => {
    behavior.checks++;
    if (behavior.mode === "initial-invariant-error") throw new Error("invariant crash");
    return [];
  },
}));
vi.mock("../../game/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../game/index.ts")>();
  const { WorldTruth } =
    await vi.importActual<typeof import("../../sim/index.ts")>("../../sim/index.ts");
  return {
    ...actual,
    FULL_PROFILE: { births: true, conception: true },
    GAME_CONTENT_KINDS: [],
    LIFE_ENGINE: "test-engine",
    assertLifeDependencies: () => {},
    defaultGameSetup: () => ({ mode: "realistic" }),
    optionsOf: (setup: { life: unknown }) => setup.life,
    Life: {
      create: () => {
        if (behavior.mode === "create-error") throw new Error("construction conflict");
        let now = 0;
        const truth = new WorldTruth();
        const ids = truth.ids.bind(truth);
        vi.spyOn(truth, "ids").mockImplementation((table) => {
          if (behavior.mode === "coverage-final-error" && now > 0)
            throw new Error("coverage state crash");
          return ids(table);
        });
        return {
          get now() {
            return now;
          },
          world: {
            clock: { day: 10, year: 100 },
            truth,
            ledger: {},
            log: {
              all: () => {
                if (behavior.mode === "report-error") throw new Error("report crash");
                return [];
              },
            },
          },
          advanceTo: (tick: number) => {
            now = tick;
            if (behavior.mode === "advance-error" && tick >= 20)
              throw new Error("phase failed after tick moved");
          },
        };
      },
    },
  };
});

describe("full-profile: fallos de worker sin crear una Life", () => {
  const folders: string[] = [];
  beforeEach(() => {
    behavior.mode = "create-error";
    behavior.checks = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    for (const folder of folders.splice(0)) {
      for (const name of ["full-profile-1.json", "full-profile-batch.json"])
        rmSync(join(folder, name), { force: true });
      rmdirSync(folder);
    }
  });
  const config = { seeds: [1], years: 1, checkEveryDays: 1 };

  it("no referencia un reporte anterior cuando el worker termina por señal", () => {
    const folder = mkdtempSync(join(tmpdir(), "rpg-full-profile-"));
    folders.push(folder);
    writeFileSync(join(folder, "full-profile-1.json"), JSON.stringify({ old: true }));
    runFullProfileBatch(config, folder);
    const batch = JSON.parse(readFileSync(join(folder, "full-profile-batch.json"), "utf8"));
    expect(batch.runs[0]).toMatchObject({ seed: 1, stoppedEarly: true });
    expect(batch.runs[0].failure).toContain("SIGKILL");
    expect(batch.runs[0]).not.toHaveProperty("report");
    expect(process.exitCode).toBe(1);
  });

  it("avisa al iniciar la creación y conserva la reproducción cuando esta falla", () => {
    const messages: FullProfileProgress[] = [];
    const report = runFullProfileSeed(1, config, (message) => messages.push(message));
    expect(messages).toEqual([{ seed: 1, stage: "creation-start", elapsedMs: 0 }]);
    expect(report.stoppedEarly).toBe(true);
    expect(report.failure).toMatchObject({ stage: "creation" });
    expect(report.reproduction).toMatchObject({ seed: 1, replayFrom: "seed", setup: report.setup });
  });

  it("rechaza configuración inválida sin reemplazar reportes ni crear workers", () => {
    const folder = mkdtempSync(join(tmpdir(), "rpg-full-profile-"));
    folders.push(folder);
    const path = join(folder, "full-profile-1.json");
    writeFileSync(path, "old-report");
    expect(() => runFullProfileBatch({ ...config, checkEveryDays: 0 }, folder)).toThrow(RangeError);
    expect(readFileSync(path, "utf8")).toBe("old-report");
    expect(() => runFullProfileSeed(1, { ...config, years: Infinity })).toThrow(RangeError);
  });

  it("no cuenta el tick parcial como años completados ni como tiempo de rendimiento estable", () => {
    behavior.mode = "advance-error";
    const report = runFullProfileSeed(1, config);
    expect(report.failure).toMatchObject({ stage: "advance" });
    expect("performance" in report).toBe(true);
    if (!("performance" in report)) throw new Error("reporte de medición esperado");
    expect(report.to).toBe(20);
    expect(report.completeThrough).toBe(10);
    expect(report.performance.completedYears).toBe(0.1);
    expect(report.performance.observedYears).toBe(0.2);
    expect(report.performance.msPerWorldYear).toBe(report.performance.completedSimulationMs / 0.1);
    expect(report.coverage.initial).toMatchObject({ tick: 0, livingPeople: 0, fertileCouples: 0 });
    expect(report.coverage.final).toMatchObject({ tick: 20, livingPeople: 0, fertileCouples: 0 });
    expect(report.reproduction).toMatchObject({ observedTick: 20, completeThrough: 10 });
  });

  it("los fallos posteriores a la creación conservan la etapa del fallo", () => {
    behavior.mode = "initial-invariant-error";
    expect(runFullProfileSeed(1, config).failure).toMatchObject({ stage: "initial-invariants" });
    behavior.mode = "report-error";
    expect(runFullProfileSeed(1, config).failure).toMatchObject({ stage: "report" });
  });

  it("las consultas de cobertura registran su etapa inicial o final", () => {
    behavior.mode = "coverage-initial-error";
    expect(runFullProfileSeed(1, config).failure).toMatchObject({ stage: "coverage-initial" });
    behavior.mode = "coverage-final-error";
    expect(runFullProfileSeed(1, config).failure).toMatchObject({ stage: "coverage-final" });
  });
});
