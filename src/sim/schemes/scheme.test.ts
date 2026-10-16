import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, SchemeId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  decideScheme,
  endScheme,
  makeScheme,
  nextStep,
  planSteps,
  recordStep,
  type SchemerView,
  stepCauses,
} from "./index.ts";

const rng = (n = 1) => Rng.root(7 as never).fork("scheme", n);
const view = (o: Partial<SchemerView> = {}): SchemerView => ({
  motiveStrength: 0.9,
  motive: "revenge",
  boldness: 0.9,
  warmth: 0.1,
  honor: 0.1,
  fear: 0.1,
  intellect: 0.5,
  believedTargetStrength: 0.2,
  believedLoot: 0.5,
  believedWitnesses: 0.1,
  affinity: -0.8,
  ...o,
});
const ev = (n: number) => `event:${n}` as EventId;
const mk = (intellect = 0.5) =>
  makeScheme({
    id: "scheme:1" as SchemeId,
    owner: "agent:1" as AgentId,
    target: "agent:2" as AgentId,
    motive: "revenge",
    method: "murder",
    intellect,
    originEventId: ev(1),
    at: 0,
  });

describe("intrigas F1: decidir", () => {
  it("el vengativo audaz y frío trama matar", () => {
    const d = decideScheme(view(), rng());
    expect(d.scheme).toBe(true);
    expect(d.method).toBe("murder");
  });
  it("la codicia con botín elige robar", () => {
    const d = decideScheme(view({ motive: "greed", believedLoot: 1, affinity: 0 }), rng());
    expect(d.method).toBe("theft");
  });
  it("la honra, el miedo y un blanco fuerte lo frenan", () => {
    const d = decideScheme(
      view({ honor: 1, fear: 1, believedTargetStrength: 1, believedWitnesses: 1 }),
      rng(),
    );
    expect(d.scheme).toBe(false);
    expect(d.method).toBeNull();
  });
  it("determinista y monótono en audacia", () => {
    expect(decideScheme(view(), rng())).toEqual(decideScheme(view(), rng()));
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (b) => {
        const lo = decideScheme(view({ boldness: b * 0.5 }), rng());
        const hi = decideScheme(view({ boldness: b * 0.5 + 0.5 }), rng());
        expect(hi.utilityMurder).toBeGreaterThanOrEqual(lo.utilityMurder);
      }),
    );
  });
});

describe("intrigas F1: plan", () => {
  it("el intelecto acota el largo del plan", () => {
    expect(planSteps("murder", 0.1)).toHaveLength(1);
    expect(planSteps("murder", 0.5)).toHaveLength(4);
    expect(planSteps("theft", 0.9).length).toBeGreaterThan(planSteps("theft", 0.5).length);
  });
  it("todo paso tiene causas hacia el origen y el paso previo", () => {
    let s = mk();
    expect(stepCauses(s)).toEqual([ev(1)]);
    let n = 10;
    while (nextStep(s) !== null) {
      expect(stepCauses(s)).toContain(ev(1));
      s = recordStep(s, ev(n++));
    }
    expect(s.status).toBe("succeeded");
    expect(s.log).toHaveLength(s.steps.length);
    expect(recordStep(s, ev(99))).toBe(s);
  });
  it("cerrar antes de tiempo detiene el plan y no pisa un éxito", () => {
    const s = endScheme(recordStep(mk(), ev(2)), "exposed");
    expect(s.status).toBe("exposed");
    expect(nextStep(s)).toBeNull();
    const done = recordStep(mk(0.1), ev(2));
    expect(endScheme(done, "failed").status).toBe("succeeded");
  });
});
