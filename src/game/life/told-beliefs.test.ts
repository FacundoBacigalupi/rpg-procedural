import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { type Beliefs, believed, type Heard } from "../../sim/index.ts";
import { learnToldClaims, TOLD_ALIVE_CONFIDENCE } from "./knowing.ts";

const A = "agent:a" as AgentId;
const B = "agent:b" as AgentId;
const C = "agent:c" as AgentId;
const HOUR = 3_600;

const heard = (claim: "dead" | "alive", at: number): Heard => ({
  claims: [{ about: B, claim, from: C, at }],
});

describe("lo oído como creencia told (HEARD → BELIEFS)", () => {
  it("«murió» queda como alive=false con fuente told y la confianza de oídas", () => {
    const b = learnToldClaims(undefined, A, heard("dead", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    const belief = believed(b, B, "alive");
    expect(belief?.value).toBe(false);
    expect(belief?.confidence).toBe(TOLD_ALIVE_CONFIDENCE);
    expect(belief?.sources).toEqual([{ kind: "told", from: C, tick: 10 * HOUR }]);
  });

  it("la misma afirmación no suma dos veces ni fuera de la última hora", () => {
    const h = heard("alive", 10 * HOUR);
    const once = learnToldClaims(undefined, A, h, 9 * HOUR + 1, 10 * HOUR);
    expect(learnToldClaims(once, A, h, 9 * HOUR + 1, 10 * HOUR)).toBe(once);
    expect(learnToldClaims(once, A, h, 10 * HOUR, 11 * HOUR)).toBe(once);
  });

  it("choca con lo que ya creía: una creencia firme no cae por un solo «murió»", () => {
    const firm: Beliefs = {
      items: [
        {
          prop: { kind: "attr", subject: B, attr: "alive" },
          value: true,
          confidence: 0.95,
          asOf: 10 * HOUR,
          learnedAt: 0,
          sources: [],
          salience: 1,
          measured: 10 * HOUR,
        },
      ],
    };
    const after = learnToldClaims(firm, A, heard("dead", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    expect(believed(after, B, "alive")?.value).toBe(true);
    expect(believed(after, B, "alive")?.confidence).toBeLessThan(0.95);
  });

  it("nadie guarda lo que le cuentan de sí mismo", () => {
    const mine: Heard = { claims: [{ about: A, claim: "dead", from: C, at: 10 * HOUR }] };
    expect(learnToldClaims(undefined, A, mine, 0, 10 * HOUR)).toBeUndefined();
  });
});
