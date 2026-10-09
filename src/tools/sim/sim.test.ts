import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import { deterministicPart, runSim } from "./sim.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const setup = { game: defaultGameSetup("realistic"), frequency: 8 };

describe("sim headless", () => {
  it("corre un año sin violar invariantes y reporta métricas", () => {
    const r = runSim({ seed: 11, content, setup, years: 1 });
    expect(r.stoppedEarly).toBe(false);
    expect(r.repro).toBeUndefined();
    expect(r.checks).toBeGreaterThan(5);
    expect(r.metrics.agentsAlive).toBeGreaterThan(0);
    expect(r.metrics.ledgerProblems).toBe(0);
    expect(r.metrics.events).toBeGreaterThan(0);
    const b = r.metrics.beliefs;
    expect(b.beliefs).toBeGreaterThanOrEqual(b.mistaken);
    expect(b.mistakenShare).toBeGreaterThanOrEqual(0);
    expect(b.mistakenShare).toBeLessThanOrEqual(1);
    expect(b.confidentlyWrong).toBeLessThanOrEqual(b.mistaken);
    expect(r.metrics.memories.items).toBeGreaterThanOrEqual(0);
    const i = r.metrics.inference;
    expect(i.checked).toBeLessThanOrEqual(i.total);
    expect(i.wrong).toBeLessThanOrEqual(i.checked);
    expect(i.confidentlyWrong).toBeLessThanOrEqual(i.wrong);
  }, 300_000);

  it("es determinista: mismo seed, mismo reporte", () => {
    const a = runSim({ seed: 5, content, setup, years: 0.25 });
    const b = runSim({ seed: 5, content, setup, years: 0.25 });
    expect(deterministicPart(a)).toBe(deterministicPart(b));
  }, 300_000);
});
