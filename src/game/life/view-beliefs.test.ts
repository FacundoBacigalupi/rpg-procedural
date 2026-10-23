// La vista reconoce a la gente por lo que el personaje cree (player-loop §9), no por la verdad.

import { describe, expect, it } from "vitest";
import type { AgentId, Tick } from "../../core/index.ts";
import { learn, type Percept } from "../../sim/index.ts";
import { heldRecognition, RECENT_SIGHT_TICKS, recognizedFromBeliefs } from "./view.ts";

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

describe("heldRecognition", () => {
  const { identity: _gone, ...fields } = percept.fields;
  const unread: Percept = { ...percept, detail: "clear", fields };

  it("quien reconoció hace un momento y sigue a la vista no se vuelve un desconocido", () => {
    const r = heldRecognition(unread, believes(here, (now - 60) as Tick), ana, here, now);
    expect(r.fields.identity?.value).toBe(ana);
    expect(r.detail).toBe("identified");
    expect(r.fields.figure).toEqual(percept.fields.figure);
  });

  it("si lo perdió de vista un rato, o lo cree en otro lado, depende de la mirada", () => {
    const long = (now - RECENT_SIGHT_TICKS - 1) as Tick;
    for (const beliefs of [undefined, believes(here, long), believes({ hex: 9 }, now)]) {
      expect(heldRecognition(unread, beliefs, ana, here, now)).toBe(unread);
    }
  });

  it("sin figura a la vista no sostiene nada, y una lectura con cara queda como estaba", () => {
    const { figure: _f, ...bare } = fields;
    const shadow: Percept = { ...unread, detail: "vague", fields: bare };
    expect(heldRecognition(shadow, believes(here, now), ana, here, now)).toBe(shadow);
    expect(heldRecognition(percept, believes(here, now), ana, here, now)).toBe(percept);
  });
});
