import { describe, expect, it } from "vitest";
import { type Acquaintance, type SpeakActsOptions, speakActCandidates } from "./speakacts.ts";

const o: SpeakActsOptions = { minFamiliarity: 0.3, quietSeconds: 1000, weight: 0.4, chance: 0.9 };
const p = (id: string, over: Partial<Acquaintance> = {}): Acquaintance => ({
  id,
  familiarity: 0.8,
  affection: 0.5,
  updated: 0,
  whereaboutsKnown: true,
  ...over,
});

describe("speak con acto declarado", () => {
  it("saluda a quien conoce y no trata hace tiempo, con ánimo desde afecto y familiaridad", () => {
    const [c, ...rest] = speakActCandidates([p("agent:2")], 5000, o);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({
      id: "speak:agent:2",
      verb: "speak",
      target: "agent:2",
      act: { kind: "greet" },
      mood: 0.26,
      chance: 0.9,
    });
  });

  it("no saluda a un desconocido, a quien trató hace poco ni a quien le cae mal", () => {
    expect(speakActCandidates([p("agent:2", { familiarity: 0.1 })], 5000, o)).toEqual([]);
    expect(speakActCandidates([p("agent:2", { updated: 4500 })], 5000, o)).toEqual([]);
    expect(speakActCandidates([p("agent:2", { affection: -0.5 })], 5000, o)).toEqual([]);
  });

  it("pregunta por el querido de quien no sabe dónde está, y no a él mismo", () => {
    const out = speakActCandidates(
      [p("agent:2", { updated: 4900 }), p("agent:3", { whereaboutsKnown: false, updated: 4900 })],
      5000,
      o,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "speak:agent:2",
      act: { kind: "ask", about: "agent:3" },
    });
  });

  it("orden fijo por id, sin repetir un conocido", () => {
    const out = speakActCandidates([p("agent:9"), p("agent:2")], 5000, o);
    expect(out.map((c) => c.id)).toEqual(["speak:agent:2", "speak:agent:9"]);
  });
});
