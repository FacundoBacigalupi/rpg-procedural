import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId, Tick } from "../../core/index.ts";
import type { HeardRumor, Rumors } from "../../sim/index.ts";
import { grievanceDeltas, grievanceOf, type RumorGrievance } from "./grievance.ts";

const A = "agent:a" as AgentId;
const B = "agent:b" as AgentId;
const C = "agent:c" as AgentId;
const D = "agent:d" as AgentId;
const ROOT = "event:9" as EventId;

const heard = (by: AgentId | null, severity = 1): Rumors => {
  const item: HeardRumor = {
    root: ROOT,
    content: { kind: "theft", by, victim: B, severity },
    at: 0 as Tick,
    heardAt: 0 as Tick,
    confidence: 0.7,
    hops: 1,
    variant: `${ROOT}#${D}`,
    parent: null,
    teller: C,
    voices: 1,
  };
  return { items: [item], told: [] };
};
const told = (listener: AgentId): Event =>
  ({
    kind: "rumor.told",
    actors: [C, listener],
    data: { deed: ROOT, credit: 0.7 },
  }) as unknown as Event;

describe("agravio de tercero por rumor", () => {
  it("el oyente se indigna con el culpable según lo cerca que está de la víctima", () => {
    const g = grievanceOf(told(D), heard(A)) as RumorGrievance;
    expect(g?.accused).toBe(A);
    const near = grievanceDeltas(g, 0.8);
    const far = grievanceDeltas(g, 0.3);
    expect(near?.trust).toBeLessThan(far?.trust ?? 0);
    expect(near?.trust).toBeLessThan(0);
  });
  it("nada si no hay culpable, es parte del hecho o la víctima le es ajena", () => {
    expect(grievanceOf(told(D), heard(null))).toBeNull();
    expect(grievanceOf(told(A), heard(A))).toBeNull();
    expect(grievanceOf(told(B), heard(A))).toBeNull();
    const g = grievanceOf(told(D), heard(A)) as RumorGrievance;
    expect(grievanceDeltas(g, 0.05)).toBeNull();
  });
});
