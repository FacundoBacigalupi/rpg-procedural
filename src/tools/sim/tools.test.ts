import { describe, expect, it } from "vitest";
import { parseSeeds, runBatch, summarizeReports } from "./batch.ts";
import { diffMetrics, formatDiff } from "./diff.ts";
import { escapeHtml, renderDiffHtml } from "./html.ts";
import type { SimOptions, SimReport } from "./sim.ts";

function fake(seed: number, events: number, extra = 0): SimReport {
  return {
    seed,
    years: 1,
    from: 0,
    to: 1,
    stoppedEarly: seed === 99,
    checks: 3,
    metrics: { events, eventsByKind: { "body.died": extra }, playerAlive: true },
    hash: "h",
  } as unknown as SimReport;
}

describe("sim:batch y sim:diff", () => {
  it("parsea rangos y listas de seeds", () => {
    expect(parseSeeds("7")).toEqual([7]);
    expect(parseSeeds("1..3,5,3..4")).toEqual([1, 2, 3, 5, 4]);
    expect(() => parseSeeds("x")).toThrow();
    expect(() => parseSeeds("5..2")).toThrow();
  });

  it("resume métricas contando la ausente como 0", () => {
    const s = summarizeReports([fake(1, 10, 2), fake(2, 20)]);
    expect(s["metrics.events"]).toEqual({ mean: 15, min: 10, max: 20, present: 2 });
    expect(s["metrics.eventsByKind.body.died"]?.mean).toBe(1);
    expect(s["metrics.playerAlive"]?.mean).toBe(1);
  });

  it("el lote usa el runner inyectado y anota las detenidas", () => {
    const run = (o: SimOptions) => fake(o.seed, o.seed);
    const r = runBatch([1, 99], { years: 1 } as Omit<SimOptions, "seed">, run);
    expect(r.stopped).toEqual([99]);
    expect(r.summary["metrics.events"]?.max).toBe(99);
  });

  it("diff: solo lo que cambia, con cambio relativo", () => {
    const rows = diffMetrics({ a: 10, b: 5, c: 0 }, { a: 15, b: 5, c: 2, d: 1 });
    expect(rows.map((r) => r.key)).toEqual(["a", "c", "d"]);
    expect(rows[0]?.rel).toBeCloseTo(0.5);
    expect(rows[1]?.rel).toBeUndefined();
    expect(diffMetrics({ a: 10 }, { a: 10.5 }, 0.1)).toEqual([]);
    expect(formatDiff([])).toBe("sin diferencias\n");
    expect(formatDiff(rows)).toContain("+50.0 %");
  });

  it("el HTML escapa", () => {
    expect(escapeHtml('<a "x">&')).toBe("&lt;a &quot;x&quot;&gt;&amp;");
    expect(renderDiffHtml(diffMetrics({ "<k>": 1 }, { "<k>": 2 }))).toContain("&lt;k&gt;");
  });
});
