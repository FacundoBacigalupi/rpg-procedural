import { describe, expect, it } from "vitest";
import { GAME_CONTENT_KINDS, optionsOf } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { SCENARIOS, TUNING_TARGETS, type TuningTargetEntry } from "../../sim/index.ts";
import { findScenario, scenarioRun } from "./scenario.ts";
import type { SimOptions, SimReport } from "./sim.ts";
import { evaluateTarget, formatTuning, groupTargets, runTuning } from "./tuning.ts";

const content = loadContentDir("content", GAME_CONTENT_KINDS);

const target = (over: Partial<TuningTargetEntry>): TuningTargetEntry =>
  TUNING_TARGETS.schema.parse({
    id: "t",
    feel: "algo",
    metric: "metrics.x",
    expect: { max: 1 },
    ...over,
  });

const sum = (mean: number, min = mean, max = mean) => ({ mean, min, max, present: 2 });

describe("escenarios", () => {
  it("`life` pasa los opt-in al setup y las opciones; sin él la aldea no cambia", () => {
    const plain = scenarioRun(findScenario(content, "baseline"));
    expect(plain.setup.life).toBeUndefined();
    expect(optionsOf(plain.setup)).toEqual(optionsOf({ game: plain.setup.game }));
    const bonded = scenarioRun(findScenario(content, "loan-bondage"));
    expect(bonded.setup.life?.marks).toBe(true);
    expect(optionsOf(bonded.setup).loanBondage?.maxDays).toBe(180);
    expect(optionsOf(bonded.setup).loanContagion).toBe("coin:copper");
    expect(() =>
      SCENARIOS.schema.parse({ id: "x", name: "x", description: "x", life: { nope: 1 } }),
    ).toThrow();
  });

  it("el contenido trae escenarios válidos y los arma como setup", () => {
    expect(content.all(SCENARIOS).length).toBeGreaterThan(0);
    const adult = scenarioRun(findScenario(content, "adult-start"));
    expect(adult.setup.game.entry).toEqual({ kind: "age", at: 30 });
    expect(adult.setup.frequency).toBeUndefined();
    const small = scenarioRun(findScenario(content, "small-planet"), 4);
    expect(small.setup.frequency).toBe(4);
    expect(small.years).toBe(2);
    expect(() => findScenario(content, "nada")).toThrow(/baseline/);
  });
});

describe("objetivos de calibración", () => {
  it("el contenido carga y sus escenarios existen", () => {
    expect(content.all(TUNING_TARGETS).length).toBeGreaterThan(0);
  });

  it("mide mínimo, máximo, media y tasas", () => {
    const s = { "metrics.x": sum(5, 2, 9), "metrics.y": sum(10) };
    expect(evaluateTarget(target({ stat: "max", expect: { max: 9 } }), s).ok).toBe(true);
    expect(evaluateTarget(target({ stat: "max", expect: { max: 8 } }), s).reason).toMatch(/máximo/);
    expect(evaluateTarget(target({ stat: "min", expect: { min: 3 } }), s).ok).toBe(false);
    const rate = evaluateTarget(target({ per: "metrics.y", expect: { min: 0.4, max: 0.6 } }), s);
    expect(rate.value).toBe(0.5);
    expect(rate.ok).toBe(true);
  });

  it("una métrica ausente o un divisor 0 falla", () => {
    expect(evaluateTarget(target({ metric: "metrics.z" }), {}).ok).toBe(false);
    const s = { "metrics.x": sum(1), "metrics.y": sum(0) };
    expect(evaluateTarget(target({ per: "metrics.y" }), s).ok).toBe(false);
  });

  it("rechaza tolerancias vacías o al revés", () => {
    expect(() => target({ expect: {} })).toThrow();
    expect(() => target({ expect: { min: 3, max: 1 } })).toThrow();
  });

  it("agrupa por escenario, seeds y años y corre un lote por grupo", () => {
    const a = target({ id: "a" });
    const b = target({ id: "b", expect: { max: 3 } });
    const c = target({ id: "c", seeds: "1..2" });
    expect(groupTargets([a, b, c]).map((g) => g.map((t) => t.id))).toEqual([["a", "b"], ["c"]]);

    let runs = 0;
    const fake = (o: SimOptions) => {
      runs++;
      return {
        seed: o.seed,
        years: o.years,
        from: 0,
        to: 1,
        stoppedEarly: false,
        checks: 1,
        metrics: { agentsAlive: o.seed },
        hash: "h",
      } as unknown as SimReport;
    };
    const report = runTuning(content, {}, ["village-survives"], fake);
    expect(runs).toBe(5);
    expect(report.results).toHaveLength(1);
    expect(report.ok).toBe(false); // el mínimo de seeds 1..5 es 1 < 5
    expect(formatTuning(report)).toMatch(/FALLA village-survives/);
    expect(() => runTuning(content, {}, ["nope"], fake)).toThrow(/desconocido/);
  });
});
