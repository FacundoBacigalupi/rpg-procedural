import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  type BodyCapabilities,
  DEFICIENCY_EFFECTS,
  GROWTH_SEQUELAE,
  NO_DEFICIENCY,
  WorldTruth,
} from "../../sim/index.ts";
import { applyDeficiency } from "./deficiencyCaps.ts";

const a = "agent:1" as AgentId;
const caps = {
  locomotion: 1,
  manipulation: 1,
  speech: 1,
  strength: 1,
  cognition: 1,
  endurance: 1,
  sight: 1,
  hearing: 1,
} as BodyCapabilities;

describe("applyDeficiency", () => {
  it("sin filas devuelve las mismas capacidades", () => {
    expect(applyDeficiency(caps, new WorldTruth(), a)).toBe(caps);
  });

  it("vigor, anemia, cognición y secuela bajan capacidades", () => {
    const t = new WorldTruth();
    t.set(DEFICIENCY_EFFECTS, a as EntityRef, {
      ...NO_DEFICIENCY,
      vigor: 0.5,
      oxygen: 0.4,
      cognition: 0.8,
    });
    t.set(GROWTH_SEQUELAE, a as EntityRef, { stunt: 0, cognitiveLoss: 0.25 });
    const r = applyDeficiency(caps, t, a);
    expect(r.strength).toBeCloseTo(0.5);
    expect(r.endurance).toBeCloseTo(0.3);
    expect(r.cognition).toBeCloseTo(0.6);
    expect(r.sight).toBe(1);
  });
});
