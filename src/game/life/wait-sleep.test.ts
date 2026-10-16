import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, HOUR, loadContent } from "../../core/index.ts";
import { type ActionPlan, BODY_STATE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { engineOptions, LIFE_ENGINE, Life } from "./life.ts";

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

describe("motor de la espera nocturna", () => {
  it("los motores anteriores a life-5 piden waitAwake; life-5 no", () => {
    expect(LIFE_ENGINE).toBe("life-33");
    expect(engineOptions("life-4", {}).waitAwake).toBe(true);
    expect(engineOptions("life-4", {}).verboseSteps).toBeUndefined();
    expect(engineOptions("life-3", {})).toEqual({
      verboseSteps: true,
      waitAwake: true,
      waitUntended: true,
      waitNoSkin: true,
      sleepUncapped: true,
      legacyFalls: true,
      legacyTend: true,
      legacyResume: true,
      waitEatHomeOnly: true,
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-7", {})).toEqual({
      sleepUncapped: true,
      legacyFalls: true,
      legacyTend: true,
      legacyResume: true,
      waitEatHomeOnly: true,
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-8", {})).toEqual({
      legacyFalls: true,
      legacyTend: true,
      legacyResume: true,
      waitEatHomeOnly: true,
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-9", {})).toEqual({
      legacyTend: true,
      legacyResume: true,
      waitEatHomeOnly: true,
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-10", {})).toEqual({
      legacyResume: true,
      waitEatHomeOnly: true,
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-11", {})).toEqual({
      waitEatHomeOnly: true,
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-12", {})).toEqual({
      legacyNoCare: true,
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-13", {})).toEqual({
      legacyNoFootSores: true,
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-14", {})).toEqual({
      legacyNoFootwearMend: true,
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-15", {})).toEqual({
      legacyNoCloak: true,
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-16", {})).toEqual({
      legacyNoStrain: true,
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-17", {})).toEqual({
      legacyNoCloakMend: true,
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-19", {})).toEqual({
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-18", {})).toEqual({
      legacyNoForecast: true,
      legacyNoRainForecast: true,
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-20", {})).toEqual({
      legacyNoFieldWatering: true,
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-21", {})).toEqual({
      legacyNoFieldSowing: true,
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-22", {})).toEqual({
      legacyNoFieldShared: true,
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-23", {})).toEqual({
      legacyNoSowSeed: true,
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-24", {})).toEqual({
      legacyNoExhaustion: true,
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-25", {})).toEqual({
      legacyNoCobbler: true,
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-26", {})).toEqual({
      legacyNoPerceiveCascade: true,
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-27", {})).toEqual({
      legacyNoAppraiseCascade: true,
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-28", {})).toEqual({
      legacyNoOscillation: true,
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-29", {})).toEqual({
      legacyNoLendPawnBatch: true,
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-30", {})).toEqual({
      legacyNoDeadCounterpartyGuard: true,
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-31", {})).toEqual({
      legacyNoRainWaitPersist: true,
      legacyNoGreetDecision: true,
    });
    expect(engineOptions("life-32", {})).toEqual({ legacyNoGreetDecision: true });
    expect(engineOptions("life-33", {})).toEqual({});
  });
});

describe("esperar un día entero", () => {
  /** El personaje espera 24 h seguidas desde un cuerpo descansado: cuánto sueño debe al final. */
  function debtAfterWaiting(engine: string): number {
    const life = Life.create(7, content, engineOptions(engine, { frequency: 8 }));
    const w = life.world;
    const me = life.player;
    const body = w.truth.get(BODY_STATE, me);
    if (!body) throw new Error("sin cuerpo");
    w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0, glycogen: 99999 });
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: { kind: "do", verb: "wait", args: [{ role: "for", seconds: 24 * HOUR }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    life.submit(plan, 1);
    life.advanceTo(life.now + 24 * HOUR);
    return w.truth.get(BODY_STATE, me)?.sleepDebt ?? Number.NaN;
  }

  it("dormir la noche paga la deuda: un día esperando ya no suma 8 h debidas", () => {
    const awake = debtAfterWaiting("life-4");
    const slept = debtAfterWaiting(LIFE_ENGINE);
    // Despierto 24 h: 24/3 = 8 h de deuda. Con la noche dormida (8 h a 2/3 por hora) queda cerca de 0.
    expect(awake).toBeGreaterThan(7);
    expect(slept).toBeLessThan(awake - 4);
  }, 240_000);
});
