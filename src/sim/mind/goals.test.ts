import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef } from "../../core/index.ts";
import {
  CORE_VALUE_MIN,
  coreGoals,
  GOAL_PULL,
  goalChanges,
  goalDrives,
  reconcileGoals,
  revengeGoals,
  revengeThreshold,
} from "./goals.ts";
import { formMemory, type Memories } from "./memory.ts";
import type { Mind, SchemaDef, ValueId } from "./mind.ts";

const A = "agent:2" as AgentId;
const NONE = { kind: "none" } as unknown as PlaceRef;
const ORIGIN = "event:0" as EventId;
const mem = (id: string, valence: number): Memories => ({
  items: [
    formMemory({
      eventId: id as EventId,
      kind: "combat.fight",
      with: [A],
      place: NONE,
      at: 0,
      intensity: 0.9,
      valence,
    }),
  ],
  gists: [],
});
const base = {
  memories: mem("event:9", -0.9),
  now: 0,
  warmth: 0.5,
  control: 0.5,
  strengthIsWorth: 0,
};

describe("goals", () => {
  it("el valor fuerte es un objetivo núcleo con el esquema que lo empuja de origen", () => {
    const values = { family: 0.3, power: 0.05 } as Record<ValueId, number>;
    const defs = [{ id: "family_first", values: { family: 1 } }] as unknown as SchemaDef[];
    const mind: Mind = {
      schemas: { family_first: { strength: 0.8, causes: ["event:5" as EventId] } },
      formative: [],
      originEventId: ORIGIN,
    };
    const g = coreGoals(values, defs, mind, 10);
    expect(g.map((x) => x.id)).toEqual(["core:family"]);
    expect(g[0]?.originEventId).toBe("event:5");
    expect(values.family).toBeGreaterThan(CORE_VALUE_MIN);
    expect(coreGoals(values, [], { ...mind, schemas: {} }, 10)[0]?.originEventId).toBe(ORIGIN);
  });

  it("la venganza nace al cruzar el umbral, con la memoria más dolorosa; sin memoria no nace", () => {
    expect(revengeGoals([{ who: A, resentment: 0.5 }], base)).toEqual([]);
    const g = revengeGoals([{ who: A, resentment: 0.9 }], base);
    expect(g[0]).toMatchObject({ kind: "avenge", target: A, originEventId: "event:9" });
    expect(revengeGoals([{ who: A, resentment: 0.9 }], { ...base, memories: undefined })).toEqual(
      [],
    );
    expect(revengeThreshold({ ...base, strengthIsWorth: 1 })).toBeLessThan(revengeThreshold(base));
  });

  it("reconciliar conserva el origen y el desde de los vigentes", () => {
    const [first] = revengeGoals([{ who: A, resentment: 0.9 }], { ...base, now: 5 });
    const [again] = revengeGoals([{ who: A, resentment: 0.95 }], { ...base, now: 50 });
    const out = reconcileGoals(first ? [first] : [], again ? [again] : []);
    expect(out[0]?.since).toBe(5);
    expect(out[0]?.weight).toBe(0.95);
  });
});

describe("objetivos como peso de impulsos", () => {
  const goal = (id: string, value: ValueId, weight: number) => ({
    id,
    layer: "core" as const,
    kind: "pursue" as const,
    value,
    weight,
    originEventId: ORIGIN,
    since: 0,
  });

  it("goalDrives suma al valor perseguido y no toca los demás", () => {
    const out = goalDrives({ needs: {}, values: { family: 0.2, power: 0.1 } }, [
      goal("core:family", "family", 0.4),
    ]);
    expect(out.values.family).toBeCloseTo(0.2 + GOAL_PULL * 0.4);
    expect(out.values.power).toBe(0.1);
  });

  it("goalChanges separa los que nacen de los que terminan", () => {
    const a = goal("core:family", "family", 0.4);
    const b = goal("core:power", "power", 0.3);
    const c = goalChanges([a], [a, b]);
    expect(c.born.map((g) => g.id)).toEqual(["core:power"]);
    expect(c.ended).toEqual([]);
    expect(goalChanges([a, b], [b]).ended.map((g) => g.id)).toEqual(["core:family"]);
  });
});
