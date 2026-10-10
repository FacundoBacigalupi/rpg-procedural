import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef } from "../../core/index.ts";
import { CLEAN, type SubstanceDef } from "../body/substance.ts";
import { goalChanges, layerDrives, reconcileGoals } from "./goals.ts";
import {
  feltCompanyNeed,
  feltCravingNeeds,
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
  it("ansia exige procedencia propia de dosis o señal presente; no inventa metadata de partidas viejas", () => {
    const def: SubstanceDef = {
      id: "wine",
      routes: {},
      halfLifeHours: 1,
      ec50: 1,
      hill: 1,
      latencyHours: 1,
      toxicThreshold: 0,
      damagePerHourAtDouble: 0,
      repairHalfHours: 1,
      dependence: {
        potential: 0.5,
        tolerancePerUse: 0.1,
        withdrawalOnsetHours: 1,
        withdrawalPeakHours: 2,
        recoveryHalfDays: 20,
      },
    };
    const state = { ...CLEAN, hoursSinceUse: 10, dependence: 1 };
    const held = { substance: def.id, state };
    expect(feltCravingNeeds([held], [def], [], undefined, 1000, 1000)).toEqual([]);
    const signals = feltCravingNeeds(
      [{ ...held, originEventId: E(8) }],
      [def],
      [],
      undefined,
      1000,
      1000,
    );
    expect(immediateGoals(signals, undefined, [], 1000)[0]).toMatchObject({
      id: "immediate:craving",
      weight: 1,
      originEventId: E(8),
    });
    const context = { hex: 0, people: [], hour: 0 };
    const cue = {
      substance: def.id,
      kind: "place" as const,
      key: "hex:0",
      strength: 0.6,
      at: 1000,
    };
    expect(feltCravingNeeds([], [], [cue], context, 1000, 1000)).toEqual([]);
    expect(
      immediateGoals(
        feltCravingNeeds([], [], [{ ...cue, originEventId: E(9) }], context, 1000, 1000),
        undefined,
        [],
        1000,
      )[0],
    ).toMatchObject({ weight: 0.6, originEventId: E(9) });
    expect(
      feltCravingNeeds(
        [],
        [],
        [{ ...cue, originEventId: E(9) }],
        { ...context, hex: 1 },
        1000,
        1000,
      ),
    ).toEqual([]);
    expect(
      feltCravingNeeds([], [], [{ ...cue, at: 2000, originEventId: E(9) }], context, 1000, 1000),
    ).toEqual([]);
    expect(
      immediateGoals(
        feltCravingNeeds([], [], [{ ...cue, originEventId: E(9) }], context, 2000, 1000),
        undefined,
        [],
        2000,
      ),
    ).toEqual([]);
  });

  it("compañía cita el contacto grato vivido más reciente, sin inventar vínculos o contactos", () => {
    const who = "agent:2" as AgentId;
    const warm = { ...memory, valence: 0.8, perceived: { ...memory.perceived, with: [who] } };
    const older = { ...warm, eventId: E(1), at: 900 };
    const source = feltCompanyNeed(
      { items: [older, warm], gists: [] },
      2000,
      0.7,
      (id) => id === who,
    );
    expect(source).toEqual({ need: "social", urgency: 0.7, originEventId: E(2) });
    expect(immediateGoals(source ? [source] : [], undefined, [], 2000)[0]).toMatchObject({
      id: "immediate:social",
      value: "family",
      weight: 0.7,
      originEventId: E(2),
    });
    expect(feltCompanyNeed(undefined, 2000, 1, () => true)).toBeUndefined();
    expect(feltCompanyNeed({ items: [warm], gists: [] }, 2000, 1, () => false)).toBeUndefined();
    for (const other of [
      { ...warm, at: 3000 },
      { ...warm, valence: -1 },
      { ...warm, source: "told" as const },
      { ...warm, source: "inferred" as const },
      { ...warm, confidence: 0 },
    ]) {
      expect(feltCompanyNeed({ items: [other], gists: [] }, 2000, 1, () => true)).toBeUndefined();
    }
    expect(
      immediateGoals([{ need: "social", urgency: 0.1, originEventId: E(2) }], undefined, [], 2000),
    ).toEqual([]);
  });

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
