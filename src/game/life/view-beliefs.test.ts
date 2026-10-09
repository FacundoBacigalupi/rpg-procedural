// La vista reconoce a la gente por lo que el personaje cree (player-loop §9), no por la verdad.

import { describe, expect, it } from "vitest";
import type { AgentId, Tick } from "../../core/index.ts";
import { learn, type Percept } from "../../sim/index.ts";
import { recognizedFromBeliefs } from "./view.ts";

const ana = "agent:1" as AgentId;
const me = "agent:0" as AgentId;
const now = 100_000 as Tick;
const here = { hex: 4 };

const percept: Percept = {
  id: "p1",
  observer: me,
  tick: now,
  channels: ["sight"],
  detail: "identified",
  fields: {
    figure: { value: "adult", confidence: 0.9, mistaken: false },
    identity: { value: ana, confidence: 0.9, mistaken: false },
  },
};

const believes = (at: { hex: number }, tick: Tick) =>
  learn(
    undefined,
    {
      prop: { kind: "attr", subject: ana, attr: "at" },
      value: at,
      confidence: 0.9,
      asOf: tick,
      source: { kind: "percept", percept: "x", tick },
    },
    tick,
  );

describe("recognizedFromBeliefs", () => {
  it("reconoce a quien cree que está acá", () => {
    expect(recognizedFromBeliefs(percept, believes(here, now), here, now)).toBe(percept);
  });

  it("sin creencia, o con una creencia de otro lugar, queda sin identidad", () => {
    for (const beliefs of [undefined, believes({ hex: 9 }, now)]) {
      const r = recognizedFromBeliefs(percept, beliefs, here, now);
      expect(r.fields.identity).toBeUndefined();
      expect(r.detail).toBe("clear");
      expect(r.fields.figure).toBeDefined();
    }
  });

  it("una creencia que ya se desvaneció no reconoce", () => {
    const old = (now - 72 * 3_600) as Tick;
    const r = recognizedFromBeliefs(percept, believes(here, old), here, now);
    expect(r.fields.identity).toBeUndefined();
  });
});
