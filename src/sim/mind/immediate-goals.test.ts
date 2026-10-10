import { describe, expect, it } from "vitest";
import type { EventId, PlaceRef } from "../../core/index.ts";
import { goalChanges, layerDrives, reconcileGoals } from "./goals.ts";
import {
  IMMEDIATE_FEAR_HALF_LIFE,
  immediateGoals,
  MAX_IMMEDIATE_GOALS,
} from "./immediate-goals.ts";
import { formMemory } from "./memory.ts";

const E = (n: number) => `event:${n}` as EventId;
const memory = formMemory({
  eventId: E(2),
  kind: "combat.fight",
  with: [],
  place: { kind: "none" } as unknown as PlaceRef,
  at: 1000,
  intensity: 1,
  valence: -1,
});

describe("objetivos inmediatos", () => {
  it("no inventa objetivos sin señales, ni de recuerdos agradables o futuros", () => {
    expect(immediateGoals([], undefined, [], 1000)).toEqual([]);
    expect(
      immediateGoals(
        [],
        {
          items: [
            { ...memory, valence: 1 },
            { ...memory, at: 1001 },
          ],
          gists: [],
        },
        [],
        1000,
      ),
    ).toEqual([]);
  });
  it("deriva miedo de memoria propia con origen y decae en horas", () => {
    const memories = { items: [memory], gists: [] };
    expect(immediateGoals([], memories, [], 1000)[0]).toMatchObject({
      id: "immediate:fear",
      layer: "immediate",
      weight: 1,
      originEventId: E(2),
    });
    expect(immediateGoals([], memories, [], 1000 + IMMEDIATE_FEAR_HALF_LIFE)[0]?.weight).toBe(0.5);
    expect(immediateGoals([], memories, [], 1000 + 2 * IMMEDIATE_FEAR_HALF_LIFE)).toEqual([]);
  });
  it("ordena y limita determinísticamente necesidades con fuentes, sin duplicar ids", () => {
    const needs = (["hunger", "thirst", "rest", "pain"] as const).map((need) => ({
      need,
      urgency: 0.8,
      originEventId: E(4),
    }));
    const a = immediateGoals(
      [...needs, { need: "hunger", urgency: 0.8, originEventId: E(3) }],
      undefined,
      [],
      1000,
    );
    expect(a).toHaveLength(MAX_IMMEDIATE_GOALS);
    expect(a).toEqual(
      immediateGoals(
        [...needs].reverse().concat([{ need: "hunger", urgency: 0.8, originEventId: E(3) }]),
        undefined,
        [],
        1000,
      ),
    );
    expect(a[0]).toMatchObject({ id: "immediate:hunger", weight: 0.8, originEventId: E(3) });
  });
  it("conserva identidad, refresca peso y termina al saciarse sin empuje de capas", () => {
    const first = immediateGoals(
      [{ need: "thirst", urgency: 0.8, originEventId: E(1) }],
      undefined,
      [],
      1000,
    );
    const next = reconcileGoals(
      first,
      immediateGoals([{ need: "thirst", urgency: 0.9, originEventId: E(2) }], undefined, [], 2000),
    );
    expect(next[0]).toMatchObject({ weight: 0.9, since: 1000, originEventId: E(1) });
    expect(goalChanges(first, next)).toEqual({ born: [], ended: [] });
    const end = immediateGoals(
      [{ need: "thirst", urgency: 0.1, originEventId: E(2) }],
      undefined,
      [],
      3000,
    );
    expect(goalChanges(next, end).ended).toEqual(next);
    const drives = { needs: { thirst: 0.8 }, values: { safety: 0.3 } };
    expect(layerDrives(drives, next)).toEqual(drives);
  });
});
