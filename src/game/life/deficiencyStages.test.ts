import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef } from "../../core/index.ts";
import { fullStores, NUTRITION, WorldTruth } from "../../sim/index.ts";
import { deficiencyStagesOf } from "./nutrition.ts";

const a = "agent:1" as AgentId;

describe("deficiencyStagesOf", () => {
  it("apagado o sin reservas guardadas no devuelve nada", () => {
    const t = new WorldTruth();
    expect(deficiencyStagesOf(t, a, true)).toBeUndefined();
    t.set(NUTRITION, a as EntityRef, { stores: { ...fullStores(), iron: 0 }, at: 0 });
    expect(deficiencyStagesOf(t, a, false)).toBeUndefined();
    expect(deficiencyStagesOf(t, a, undefined)).toBeUndefined();
  });

  it("con opt-in da las etapas por nutriente, determinista", () => {
    const t = new WorldTruth();
    t.set(NUTRITION, a as EntityRef, { stores: { ...fullStores(), iron: 0 }, at: 0 });
    const s = deficiencyStagesOf(t, a, true);
    expect(s?.iron).toBe("severe");
    expect(s?.protein).toBe("none");
    expect(deficiencyStagesOf(t, a, true)).toEqual(s);
  });
});
