import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import { birthStakes, bornSecret, KEPT_SECRETS, secretAbout, stakesAt } from "./knowledge.ts";

const VICTIM = "agent:9" as AgentId;
const CAUSE = "event:1" as EventId;
const DAY = 86_400;

const killing = {
  about: VICTIM,
  attr: "alive" as const,
  harm: 1,
  moralWeight: 0.8,
  fearOfExposure: 0.6,
  at: 0,
  cause: CAUSE,
};

describe("nacimiento de secretos", () => {
  it("matar nace como secreto con el costo del daño, la condena y el miedo", () => {
    const s = bornSecret(undefined, killing);
    const found = secretAbout(s, VICTIM);
    expect(found?.attr).toBe("alive");
    expect(found?.cause).toBe(CAUSE);
    expect(found?.stakes).toBeCloseTo(birthStakes(killing), 5);
    expect(birthStakes({ ...killing, moralWeight: 0, fearOfExposure: 0 })).toBeLessThan(
      birthStakes(killing),
    );
  });

  it("sin daño no hay qué esconder", () => {
    expect(bornSecret(undefined, { ...killing, harm: 0 }).items).toEqual([]);
  });

  it("decae con el tiempo y se agrava si vuelve a pasar lo mismo", () => {
    const s = bornSecret(undefined, killing);
    const first = s.items[0];
    if (!first) throw new Error("sin secreto");
    expect(stakesAt(first, 365 * DAY)).toBeCloseTo(first.stakes / 2, 4);
    const again = bornSecret(s, { ...killing, at: 10 * DAY });
    expect(again.items).toHaveLength(1);
    expect(again.items[0]?.stakes ?? 0).toBeGreaterThan(first.stakes);
  });

  it("guarda un máximo y descarta el de menor costo", () => {
    let s = bornSecret(undefined, killing);
    for (let i = 0; i < KEPT_SECRETS + 3; i++) {
      s = bornSecret(s, { ...killing, about: `agent:${100 + i}` as AgentId, harm: 0.5 });
    }
    expect(s.items.length).toBe(KEPT_SECRETS);
    expect(secretAbout(s, VICTIM)).toBeDefined();
  });
});
