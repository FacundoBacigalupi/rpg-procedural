import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import {
  ABSENCE_WEIGHT,
  type Beliefs,
  beliefConfidenceAt,
  believed,
  doubtAt,
  learn,
} from "../../sim/index.ts";
import { lookAcuity, searchedInVain } from "./looking.ts";

const MOM = "agent:2" as AgentId;
const source = {
  kind: "reasoning",
  evidence: ["event:9"],
  rules: ["search.absent"],
  tick: 100,
} as const;

function sawAt(hex: number): Beliefs {
  const seen = (attr: "at" | "alive", value: boolean | { hex: number }) => ({
    prop: { kind: "attr", subject: MOM, attr } as const,
    value,
    confidence: 0.9,
    asOf: 10,
    source: { kind: "percept", percept: "p", tick: 10 } as const,
  });
  return learn(learn(undefined, seen("at", { hex }), 10), seen("alive", true), 10);
}

describe("mirar a propósito", () => {
  it("solo el efecto observe cuenta como mirar, con su agudeza", () => {
    expect(lookAcuity({ effect: { kind: "observe", acuity: 0.7 } })).toBe(0.7);
    expect(lookAcuity({ effect: { kind: "observe" } })).toBe(0);
    expect(lookAcuity({ effect: { kind: "eat" } })).toBeUndefined();
    expect(lookAcuity(null)).toBeUndefined();
  });
});

describe("buscar y no encontrar", () => {
  it("solo cuenta la búsqueda de una persona sin hallazgo ni vistazo", () => {
    const fx = (over: object) => ({
      effect: { kind: "search", target: MOM, found: false, glimpsed: false, ...over },
    });
    expect(searchedInVain(fx({}))).toBe(MOM);
    expect(searchedInVain(fx({ found: true }))).toBeUndefined();
    expect(searchedInVain(fx({ glimpsed: true }))).toBeUndefined();
    expect(searchedInVain(fx({ target: "place:1" }))).toBeUndefined();
    expect(searchedInVain({ effect: { kind: "observe" } })).toBeUndefined();
  });

  it("buscarla donde la creía le baja la confianza, sin inventar otro lugar", () => {
    const before = sawAt(3);
    const after = doubtAt(before, MOM, { hex: 3 }, 100, source);
    const was = believed(before, MOM, "at");
    const now = believed(after, MOM, "at");
    if (!was || !now) throw new Error("sin creencia");
    expect(now.value).toEqual({ hex: 3 });
    expect(beliefConfidenceAt(now, 100)).toBeCloseTo(
      beliefConfidenceAt(was, 100) * (1 - ABSENCE_WEIGHT),
      4,
    );
    expect(now.sources.at(-1)).toEqual(source);
    // Que viva no se toca: buscarla en un lugar no dice nada de eso.
    expect(believed(after, MOM, "alive")).toEqual(believed(before, MOM, "alive"));
  });

  it("buscarla en otro lugar, o sin creer nada, no cambia nada", () => {
    const before = sawAt(3);
    expect(doubtAt(before, MOM, { hex: 4 }, 100, source)).toBe(before);
    expect(doubtAt(undefined, MOM, { hex: 3 }, 100, source)).toBeUndefined();
  });
});
