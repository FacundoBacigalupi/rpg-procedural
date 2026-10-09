import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef } from "../../core/index.ts";
import type { MentalState } from "./conditions.ts";
import { formMemory, type Memories } from "./memory.ts";
import type { Candidate } from "./utility.ts";
import {
  dissonanceOf,
  HABIT_PULL,
  memoryPull,
  modifyCandidates,
  moodShift,
  sanctionFor,
} from "./utility-modifiers.ts";

const A = "agent:2" as AgentId;
const NONE = { kind: "none" } as unknown as PlaceRef;
const talk: Candidate = { id: "speak:a", verb: "speak", target: A, contributes: {}, chance: 1 };
const memories = (valence: number): Memories => ({
  items: [
    formMemory({
      eventId: "event:1" as EventId,
      kind: "action.talk",
      with: [A],
      place: NONE,
      at: 0,
      intensity: 0.8,
      valence,
    }),
  ],
  gists: [],
});
const mental = (): MentalState => ({
  conditions: [
    {
      kind: "trauma",
      severity: 0.8,
      originEventIds: ["event:9" as EventId],
      onset: 0,
      course: "acute",
      triggers: [{ who: A }],
    },
  ],
  kills: 0,
  updated: 0,
  originEventId: "event:9" as EventId,
});

describe("modificadores de la utilidad", () => {
  it("sin insumos no cambia nada", () => {
    const cs = [talk, { id: "x", verb: "eat", contributes: {}, chance: 1 }];
    expect(modifyCandidates(cs, { now: 0 })).toEqual(cs);
  });

  it("las memorias gratas empujan a tratar y las dolorosas frenan", () => {
    expect(memoryPull(memories(0.8), A, 0)).toBeGreaterThan(0);
    expect(memoryPull(memories(-0.8), A, 0)).toBeLessThan(0);
    expect(moodShift(talk, { now: 0, memories: memories(0.8) })).toBeGreaterThan(0);
  });

  it("el hábito asentado empuja su verbo", () => {
    expect(moodShift(talk, { now: 0, habits: { speak: 1 } })).toBeCloseTo(HABIT_PULL, 5);
  });

  it("actuar contra un valor propio pesa como culpa", () => {
    const steal: Candidate = { ...talk, verb: "take", contributes: { justice: -1 } };
    expect(dissonanceOf(steal, { justice: 0.5 })).toBeGreaterThan(0);
    expect(dissonanceOf(steal, { wealth: 1 })).toBe(0);
  });

  it("la evitación castiga acercarse y premia alejarse de lo que dispara el trauma", () => {
    expect(moodShift(talk, { now: 0, mental: mental() })).toBeLessThan(0);
    expect(
      moodShift({ ...talk, id: `avoid:${A}`, verb: "move" }, { now: 0, mental: mental() }),
    ).toBeGreaterThan(0);
  });

  it("el entumecimiento achica el placer y la sanción resta", () => {
    const joy: Candidate = { id: "j", verb: "eat", contributes: { pleasure: 1 }, chance: 1 };
    expect(modifyCandidates([joy], { now: 0, sanction: () => 0.5 })[0]?.mood).toBeCloseTo(-0.5, 5);
  });
});

describe("sanctionFor", () => {
  const take = (id: string, target?: string): Candidate => ({
    id,
    verb: "take",
    ...(target === undefined ? {} : { target }),
    contributes: {},
    chance: 1,
  });
  const weigh = (g: string) => (g === "pan" ? 0.7 : 0);

  it("pesa el bien que nombra la candidata que toma", () => {
    const s = sanctionFor(weigh);
    expect(s(take("take:agent:ana+pan", "agent:ana"))).toBe(0.7);
    expect(s(take("take:agent:ana+sal", "agent:ana"))).toBe(0);
  });

  it("sin bien nombrado o con otro verbo no pesa nada", () => {
    const s = sanctionFor(() => 1);
    expect(s(take("take:agent:ana", "agent:ana"))).toBe(0);
    expect(s({ ...take("give:agent:ana+pan", "agent:ana"), verb: "give" })).toBe(0);
  });
});
