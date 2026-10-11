import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import type { Goal, Memories } from "../../sim/index.ts";
import type { DebtBelief, DebtBook } from "./debtknowledge.ts";
import { debtGoalEvidence, debtGoalProgress } from "./goal-evidence.ts";

const creditor = "agent:2" as AgentId;
const goal: Goal = {
  id: `medium:debt:${creditor}`,
  layer: "medium",
  kind: "pursue",
  value: "justice",
  target: creditor,
  weight: 0.5,
  originEventId: "event:1" as EventId,
  since: 10,
};
const book = (status: DebtBelief["status"], role: DebtBelief["role"] = "debtor"): DebtBook =>
  ({
    items: [
      {
        commitment: "commitment:1",
        role,
        other: creditor,
        status,
        originEventId: "event:1" as EventId,
        sources: ["event:1", "event:2", "event:3", "event:4"],
      },
    ],
  }) as unknown as DebtBook;
const memories = (...events: [number, number][]): Memories =>
  ({
    items: events.map(([n, at]) => ({ eventId: `event:${n}` as EventId, at })),
    gists: [],
  }) as unknown as Memories;

describe("life.goal-evidence", () => {
  it("la deuda saldada aporta un pago recordado por evidencia, sin la apertura", () => {
    const out = debtGoalEvidence(goal, memories([2, 100], [3, 200], [4, 300]), book("fulfilled"));
    expect(out.map((e) => e.cause)).toEqual(["event:2", "event:3", "event:4"]);
    expect(out.map((e) => e.at)).toEqual([100, 200, 300]);
  });

  it("sin deuda saldada, sin rol de deudor, sin memoria o con otra meta no hay evidencia", () => {
    const m = memories([2, 100], [3, 200]);
    expect(debtGoalEvidence(goal, m, book("active"))).toEqual([]);
    expect(debtGoalEvidence(goal, m, book("fulfilled", "creditor"))).toEqual([]);
    expect(debtGoalEvidence(goal, undefined, book("fulfilled"))).toEqual([]);
    expect(debtGoalEvidence({ ...goal, id: "medium:kin:agent:2" }, m, book("fulfilled"))).toEqual(
      [],
    );
  });

  it("declara concreta solo la deuda", () => {
    const p = debtGoalProgress(86_400);
    expect(p.concrete(goal)).toBe(true);
    expect(p.concrete({ ...goal, id: "medium:rival:agent:2" })).toBe(false);
    expect(p.minSpan).toBe(86_400);
  });
});
