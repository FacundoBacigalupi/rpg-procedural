import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, makeId, type OrgId } from "../../core/index.ts";
import { foundCouncil } from "./council.ts";
import {
  DEFAULT_LOYALTY_RULES,
  loyaltyOf,
  loyaltyViolations,
  outcomeDelta,
  shiftLoyalty,
} from "./loyalty.ts";

const ev = makeId("event", 1) as EventId;
const who = makeId("agent", 1) as AgentId;

describe("sim/org/loyalty", () => {
  it("sube con lo cumplido, baja con lo fallido y peor con lo desobedecido", () => {
    const r = DEFAULT_LOYALTY_RULES;
    expect(outcomeDelta("executed", r)).toBeGreaterThan(0);
    expect(outcomeDelta("failed", r)).toBeLessThan(0);
    expect(outcomeDelta("refused", r)).toBeLessThan(outcomeDelta("failed", r));
    const up = shiftLoyalty(undefined, who, 0.3, 5, ev);
    expect(loyaltyOf(up, who)).toBeCloseTo(0.3);
    expect(up.toward[who as string]?.cause).toBe(ev);
    expect(loyaltyOf(shiftLoyalty(up, who, -0.1, 6, ev), who)).toBeCloseTo(0.2);
  });

  it("quien nunca tuvo trato no pierde lealtad que no tenía", () => {
    const l = shiftLoyalty(undefined, who, -0.2, 5, ev);
    expect(loyaltyOf(l, who)).toBe(0);
    expect(Object.keys(l.toward)).toHaveLength(0);
  });

  it("propiedad: siempre acotada 0-1, determinista y sin violaciones", () => {
    const org = foundCouncil({
      id: makeId("org", 1) as OrgId,
      settlement: makeId("settlement", 1),
      elders: [{ agent: who, ageYears: 60 }],
      originEventId: ev,
      at: 0,
    });
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { maxLength: 30 }),
        (deltas) => {
          const run = () => {
            let l = undefined as ReturnType<typeof shiftLoyalty> | undefined;
            deltas.forEach((d, i) => {
              l = shiftLoyalty(l, who, d, i, ev);
            });
            return l;
          };
          const a = run();
          expect(JSON.stringify(a)).toBe(JSON.stringify(run()));
          const v = loyaltyOf(a, who);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          if (a) expect(loyaltyViolations(org, a)).toEqual([]);
        },
      ),
    );
  });
});
