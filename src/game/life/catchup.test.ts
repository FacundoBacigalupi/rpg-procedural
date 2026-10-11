import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, EARTHLIKE_CLOCK, loadContent, type Tick } from "../../core/index.ts";
import { BODY_PLANS, type Body, type BodyPlanDef, newBody } from "../../sim/index.ts";
import { catchUpByHour, catchUpRoutine } from "./catchup.ts";

const content = loadContent(
  [BODY_PLANS],
  [
    {
      kind: "body-plans",
      file: "b.json",
      data: JSON.parse(readFileSync("content/body-plans/human.json", "utf8")),
    },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const me = "agent:1" as AgentId;
const DAY = EARTHLIKE_CLOCK.day;
const opts = {
  clock: EARTHLIKE_CLOCK,
  lonDeg: 0,
  ageYears: 30,
  ration: { kcalPerGram: 3.6, waterPerGram: 0.1 },
};

/** Un cuerpo adulto sano que arranca en una hora redonda del día (medianoche local). */
const start = (): Body => newBody(plan, 60, 0);
const at = (days: number) => (days * DAY) as Tick;

const KEYS = ["glycogen", "fat", "muscle", "water", "fatigue", "sleepDebt", "blood"] as const;

describe("catchUpRoutine: la puesta al día del dormido", () => {
  for (const days of [1, 3, 14]) {
    it(`${days} d: el atajo da lo mismo que hora por hora (comidas exactas, cuerpo casi)`, () => {
      const fast = catchUpRoutine(plan, me, start(), at(days), opts);
      const slow = catchUpByHour(plan, me, start(), at(days), opts);
      expect(fast.meals).toBe(slow.meals);
      expect(fast.grams).toBe(slow.grams);
      expect(fast.meals).toBe(3 * days);
      expect(fast.body.death).toBeNull();
      expect(fast.body.updatedAt).toBe(at(days));
      for (const k of KEYS) {
        const a = fast.body[k] as number;
        const b = slow.body[k] as number;
        const scale = Math.max(1, Math.abs(b));
        // Con el cuerpo sano el balance es lineal por tramo: el paso grueso da lo mismo salvo el redondeo.
        expect(Math.abs(a - b) / scale).toBeLessThan(1e-9);
      }
    });
  }

  it("con heridas abiertas no se atajan los pasos: sigue el paso fino y da lo mismo", () => {
    const hurt: Body = {
      ...start(),
      wounds: [
        {
          id: "w1",
          zone: "torso",
          kind: "cut",
          depth: 0.3,
          bleeding: 0.1,
          internal: 0,
          stage: "open",
          age: 0,
          cause: "event:1",
        } as never,
      ],
    };
    const fast = catchUpRoutine(plan, me, hurt, at(1), opts);
    const slow = catchUpByHour(plan, me, hurt, at(1), opts);
    expect(fast.body.blood).toBeCloseTo(slow.body.blood, 6);
    expect(fast.body.wounds.length).toBe(slow.body.wounds.length);
  });

  it("es determinista y no lee nada de afuera", () => {
    const a = catchUpRoutine(plan, me, start(), at(3), opts);
    const b = catchUpRoutine(plan, me, start(), at(3), opts);
    expect(a).toEqual(b);
  });
});
