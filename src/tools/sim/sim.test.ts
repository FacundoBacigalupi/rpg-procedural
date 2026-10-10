import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import type { HeardRumor, Rumors } from "../../sim/index.ts";
import { deterministicPart, rumorDeformationMetric, runSim } from "./sim.ts";

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

describe("métrica de deformación de rumores", () => {
  const A = "agent:a" as AgentId;
  const B = "agent:b" as AgentId;
  const E1 = "event:1" as EventId;
  const item = (hops: number, severity: number): HeardRumor => ({
    root: E1,
    content: { kind: "theft", by: A, victim: B, severity },
    at: 0 as Tick,
    heardAt: 0 as Tick,
    confidence: 0.8,
    hops,
    variant: `${E1}#${hops}`,
    parent: null,
    teller: null,
    voices: 1,
  });
  it("sin rumores da ceros y con rumores promedia por salto", () => {
    expect(rumorDeformationMetric(new Map()).roots).toBe(0);
    const m = rumorDeformationMetric(
      new Map<AgentId, Rumors | undefined>([
        [A, { items: [item(0, 1)], told: [] }],
        [B, { items: [item(1, 2)], told: [] }],
      ]),
    );
    expect(m.roots).toBe(1);
    expect(m.versions).toBe(2);
    expect(m.meanByHop["0"]).toBe(0);
    expect(m.meanByHop["1"]).toBeGreaterThan(0);
  });
});
