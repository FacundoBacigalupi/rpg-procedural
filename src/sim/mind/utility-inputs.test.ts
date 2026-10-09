import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { BODY_PLANS, type BodyPlanDef, newBody } from "../body/index.ts";
import { LIFE_STAGES, type StageDef } from "./mind.ts";
import { needsFrom, stageScaled, temperOf } from "./utility-inputs.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [BODY_PLANS, LIFE_STAGES],
  [
    { kind: "body-plans", file: "b.json", data: json("content/body-plans/human.json") },
    { kind: "life-stages", file: "s.json", data: json("content/life-stages/human.json") },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const stages = content.all(LIFE_STAGES);

describe("needsFrom", () => {
  it("un cuerpo sano y descansado no apremia por nada", () => {
    const n = needsFrom(plan, newBody(plan, 55, 0));
    for (const v of Object.values(n)) expect(v).toBeLessThan(0.15);
  });

  it("la sed, el sueño y el miedo suben su necesidad", () => {
    const base = newBody(plan, 55, 0);
    const dry = needsFrom(plan, { ...base, water: 3 }, { fear: 0.9, aloneHours: 200 });
    expect(dry.thirst).toBeGreaterThan(0.5);
    expect(dry.safety).toBeCloseTo(0.9);
    expect(dry.social).toBe(1);
    const sleepy = needsFrom(plan, { ...base, sleepDebt: 20 });
    expect(sleepy.rest).toBeGreaterThan(0.8);
  });
});

describe("etapa y temple", () => {
  it("la etapa reescala los pesos y sin etapa queda igual", () => {
    const drives = { needs: { rest: 0.5 }, values: { family: 0.3 } };
    const infancy = stages.find((s) => s.id === "infancy") as StageDef;
    const scaled = stageScaled(drives, infancy);
    expect(scaled.needs.rest).toBeGreaterThan(0.5);
    expect(scaled.values.family).toBeGreaterThan(0.3);
    expect(stageScaled(drives, undefined)).toBe(drives);
  });

  it("la audacia sale del innato", () => {
    expect(temperOf({ boldness: 0.9 }, { fear: 2 })).toEqual({ boldness: 0.9, fear: 1 });
  });
});
