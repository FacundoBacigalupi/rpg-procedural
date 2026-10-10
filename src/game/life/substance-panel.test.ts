import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  PERSON_SUBSTANCE,
  SUBSTANCE,
  type SubstanceDef,
  type SubstanceState,
  WorldTruth,
} from "../../sim/index.ts";
import { seenSubstanceSigns, urgeOf } from "./substance-panel.ts";

describe("life.substance-panel", () => {
  const def = {
    id: "toxin",
    routes: { ingest: { bioavailability: 1, halfHours: 1 } },
    halfLifeHours: 10,
    ec50: 2,
    hill: 1,
    latencyHours: 0,
    toxicThreshold: 1,
    damagePerHourAtDouble: 0.1,
    repairHalfHours: 24,
  } as unknown as SubstanceDef;
  const state = (damage: number) =>
    ({
      depot: {},
      blood: 0,
      site: 0,
      damage,
      tolerance: 0,
      dependence: 0,
      hoursSinceUse: 0,
    }) as unknown as SubstanceState;
  const who = "agent:1" as AgentId;

  it("sin filas no hay seÃ±ales; con veneno sale la etapa y nunca la sustancia", () => {
    const t = new WorldTruth();
    t.set(SUBSTANCE, "substance:1" as EntityRef, { def, source: "test" } as never);
    expect(seenSubstanceSigns(t, who)).toEqual([]);
    t.set(
      PERSON_SUBSTANCE,
      who as unknown as EntityRef,
      {
        held: [{ substance: "toxin", state: state(0.5) }],
      } as never,
    );
    const seen = seenSubstanceSigns(t, who);
    expect(seen).toEqual([{ kind: "poison", stage: "grave" }]);
    expect(JSON.stringify(seen)).not.toContain("toxin");
  });

  it("el ansia de señal sale como palabra, sin número ni sustancia", () => {
    expect(urgeOf(0)).toBeUndefined();
    expect(urgeOf(0.1)).toBe("faint");
    expect(urgeOf(0.5)).toBe("pressing");
  });
});
