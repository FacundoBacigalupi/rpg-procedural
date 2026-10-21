import { describe, expect, it } from "vitest";
import { makeId, type Tick } from "../../core/index.ts";
import {
  ATTACHMENT_BIAS,
  advanceStage,
  attachmentDeltas,
  attachmentFromMind,
  developmentProblems,
  isSensitive,
  MAX_FORMATIVE_DEV,
  noPlaceDeficit,
  recordFormative,
  stageSocial,
  startDevelopment,
} from "./development.ts";
import type { StageDef } from "./mind.ts";

const stage = (id: string, fromAge: number, sensitive: string[] = []): StageDef => ({
  id,
  species: "human",
  name: id,
  fromAge,
  plasticity: 0.5,
  sensitive,
});
const STAGES = [
  stage("infancy", 0, ["people_are_untrustworthy"]),
  stage("childhood", 4),
  stage("adolescence", 12),
  stage("adult", 30),
];
const ev = (n: number) => makeId("event", n);
const mind = (distrust: number, unworthy: number) => ({
  schemas: {
    people_are_untrustworthy: { strength: distrust, causes: [] },
    i_am_unworthy: { strength: unworthy, causes: [] },
  },
});

describe("sim.mind.development", () => {
  it("deriva el apego de los esquemas de infancia", () => {
    expect(attachmentFromMind(mind(0.1, 0.1))).toBe("secure");
    expect(attachmentFromMind(mind(0.1, 0.8))).toBe("anxious");
    expect(attachmentFromMind(mind(0.8, 0.1))).toBe("avoidant");
    expect(attachmentFromMind(mind(0.8, 0.8))).toBe("disorganized");
    expect(attachmentFromMind({ schemas: {} })).toBe("secure");
  });

  it("avanza de etapa por edad vivida y deja el evento causa", () => {
    const s0 = startDevelopment(STAGES, 3, 100 as Tick, mind(0, 0), ev(1));
    expect(s0.stage).toBe("infancy");
    expect(advanceStage(s0, STAGES, 3.9, 200 as Tick, ev(2)).transition).toBeUndefined();
    const { state, transition } = advanceStage(s0, STAGES, 12.5, 300 as Tick, ev(3), ev(4));
    expect(state.stage).toBe("adolescence");
    expect(state.riteOfPassage).toBe(ev(4));
    expect(transition).toEqual({ from: "infancy", to: "adolescence", at: 300, cause: ev(3) });
    const next = advanceStage(state, STAGES, 31, 400 as Tick, ev(5));
    expect(next.state.stage).toBe("adult");
    expect(next.state.riteOfPassage).toBeUndefined();
  });

  it("no retrocede de etapa", () => {
    const s = startDevelopment(STAGES, 40, 0 as Tick, mind(0, 0), ev(1));
    expect(advanceStage(s, STAGES, 5, 10 as Tick, ev(2)).state).toBe(s);
  });

  it("registra eventos formativos con tope, sin duplicar, y recalcula el apego", () => {
    let s = startDevelopment(STAGES, 1, 0 as Tick, mind(0, 0), ev(1));
    s = recordFormative(s, mind(0.9, 0.1), ev(10));
    expect(s.attachment).toBe("avoidant");
    expect(recordFormative(s, mind(0.9, 0.1), ev(10)).formativeEvents).toEqual([ev(10)]);
    for (let i = 0; i < 40; i++) s = recordFormative(s, mind(0.9, 0.1), ev(100 + i));
    expect(s.formativeEvents.length).toBe(MAX_FORMATIVE_DEV);
    expect(s.formativeEvents.at(-1)).toBe(ev(139));
  });

  it("sensibilidad, social por etapa y déficit sin rito", () => {
    expect(isSensitive(STAGES[0] as StageDef, "people_are_untrustworthy")).toBe(true);
    expect(isSensitive(STAGES[1] as StageDef, "people_are_untrustworthy")).toBe(false);
    expect(stageSocial("adolescence").peerWeight).toBeGreaterThan(stageSocial("adult").peerWeight);
    expect(stageSocial("desconocida").riskBias).toBe(0);
    const s = startDevelopment(STAGES, 13, 0 as Tick, mind(0, 0), ev(1));
    expect(noPlaceDeficit(s, new Set(["adolescence"]))).toBe(1);
    expect(noPlaceDeficit({ ...s, riteOfPassage: ev(2) }, new Set(["adolescence"]))).toBe(0);
    expect(noPlaceDeficit(s, new Set())).toBe(0);
  });

  it("es determinista y detecta etapas desconocidas", () => {
    const a = startDevelopment(STAGES, 20, 5 as Tick, mind(0.6, 0.2), ev(1));
    const b = startDevelopment(STAGES, 20, 5 as Tick, mind(0.6, 0.2), ev(1));
    expect(a).toEqual(b);
    expect(developmentProblems(a, STAGES)).toEqual([]);
    expect(developmentProblems({ ...a, stage: "x" }, STAGES).length).toBe(1);
  });
});

describe("sesgo de apego (attachmentDeltas)", () => {
  it("con un cercano agranda la amenaza según el estilo y deja intacto lo demás", () => {
    const d = { trust: -0.1, fear: 0.1, affection: 0.2 };
    const anx = attachmentDeltas("anxious", d, { fresh: false, close: 0.6 });
    expect(anx.trust).toBeCloseTo(-0.1 * ATTACHMENT_BIAS.anxious.threatReading);
    expect(anx.fear).toBeCloseTo(0.1 * ATTACHMENT_BIAS.anxious.threatReading);
    expect(anx.affection).toBe(0.2);
    const sec = attachmentDeltas("secure", d, { fresh: false, close: 0.6 });
    expect(Math.abs(sec.trust ?? 0)).toBeLessThan(0.1);
    // Un acto bueno (confianza que sube) no se toca.
    const good = { trust: 0.1 };
    expect(attachmentDeltas("anxious", good, { fresh: false, close: 0.6 })).toBe(good);
  });

  it("con un desconocido suma la confianza previa y no amplifica la amenaza", () => {
    const av = attachmentDeltas("avoidant", { trust: -0.1 }, { fresh: true, close: 0 });
    expect(av.trust).toBeCloseTo(-0.1 + ATTACHMENT_BIAS.avoidant.trustPrior);
    const same = { affection: 0.1 };
    expect(attachmentDeltas("secure", same, { fresh: false, close: 0.1 })).toBe(same);
  });
});
