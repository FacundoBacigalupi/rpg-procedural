import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FullProfileProgress } from "./full-profile.ts";
import { runFullProfileBatch, runFullProfileSeed } from "./full-profile-run.ts";

vi.mock("node:child_process", () => ({ spawnSync: () => ({ status: null, signal: "SIGKILL" }) }));
vi.mock("../../persistence/index.ts", () => ({ loadContentDir: () => ({ hash: "test-content" }) }));
vi.mock("../../game/index.ts", () => ({
  FULL_PROFILE: { births: true, conception: true },
  GAME_CONTENT_KINDS: [],
  LIFE_ENGINE: "test-engine",
  assertLifeDependencies: () => {},
  defaultGameSetup: () => ({ mode: "realistic" }),
  optionsOf: (setup: { life: unknown }) => setup.life,
  Life: {
    create: () => {
      throw new Error("construction conflict");
    },
  },
}));

describe("full-profile: fallos de worker sin crear una Life", () => {
  const folders: string[] = [];
  afterEach(() => {
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
});
