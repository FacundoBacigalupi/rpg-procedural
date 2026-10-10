import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { KNOWN_DEEDS, type ReadonlyWorldTruth } from "../../sim/index.ts";
import { reputationFameOf } from "./act.ts";

const me = "agent:1" as AgentId;
const a = "agent:2" as AgentId;
const b = "agent:3" as AgentId;

// Una verdad mínima: solo `ids` y `get`, lo único que lee `reputationFameOf`.
function truthWith(deeds: ReadonlyMap<AgentId, unknown>): ReadonlyWorldTruth {
  return {
    ids: () => [me, a, b],
    get: (table: { name: string }, id: AgentId) =>
      table.name === KNOWN_DEEDS.name ? deeds.get(id) : undefined,
  } as unknown as ReadonlyWorldTruth;
}

describe("reputationFameOf (trato con reputación por comunidad)", () => {
  it("sin agravios conocidos no mueve nada", () => {
    expect(reputationFameOf(truthWith(new Map()), me)).toBe(0);
  });
  it("crece con quienes lo vieron y con la gravedad", () => {
    const deed = { kind: "theft", by: me, victim: b, via: "saw" };
    const one = reputationFameOf(truthWith(new Map([[a, { deeds: [deed] }]])), me);
    const both = reputationFameOf(
      truthWith(
        new Map([
          [a, { deeds: [deed] }],
          [b, { deeds: [deed] }],
        ]),
      ),
      me,
    );
    expect(one).toBeGreaterThan(0);
    expect(both).toBeGreaterThan(one);
    expect(both).toBeLessThanOrEqual(1);
  });
});
