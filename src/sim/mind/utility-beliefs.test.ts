import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef } from "../../core/index.ts";
import { formMemory, type Memories } from "./memory.ts";
import { ASSUMED_NEED, moodFrom, otherBeliefFrom } from "./utility-beliefs.ts";

const A = "agent:2" as AgentId;
const NONE = { kind: "none" } as unknown as PlaceRef;
const DAY = 86_400;

const mem = (kind: string, valence: number, intensity: number, at: number, who = A): Memories => ({
  items: [
    formMemory({
      eventId: "event:1" as EventId,
      kind,
      with: [who],
      place: NONE,
      at,
      intensity,
      valence,
    }),
  ],
  gists: [],
});

describe("utility-beliefs", () => {
  it("el miedo sale de lo que dolió y se apaga con los días", () => {
    const m = mem("combat.fight", -0.9, 0.9, 0);
    const now = moodFrom({ memories: m, now: 0, cares: () => false, withCompany: false });
    const later = moodFrom({ memories: m, now: 400 * DAY, cares: () => false, withCompany: false });
    expect(now.fear ?? 0).toBeGreaterThan(0.5);
    expect(later.fear ?? 0).toBeLessThan(now.fear ?? 0);
  });

  it("la soledad cuenta desde la última compañía grata y se corta si hay alguien", () => {
    const m = mem("action.talk", 0.6, 0.4, 0);
    const alone = moodFrom({
      memories: m,
      now: 48 * 3600,
      cares: (w) => w === A,
      withCompany: false,
    });
    const together = moodFrom({
      memories: m,
      now: 48 * 3600,
      cares: (w) => w === A,
      withCompany: true,
    });
    expect(alone.aloneHours).toBe(48);
    expect(together.aloneHours).toBe(0);
  });

  it("la necesidad ajena sale de lo visto de su cuerpo; sin pruebas, el supuesto", () => {
    const base = { who: A, now: 0, relFear: 0, confidence: 0.8 };
    expect(otherBeliefFrom({ ...base, memories: undefined }).need).toBe(ASSUMED_NEED);
    const hurt = otherBeliefFrom({ ...base, memories: mem("body.wounded", -0.8, 0.8, 0) });
    expect(hurt.need).toBeGreaterThan(ASSUMED_NEED);
    const hit = otherBeliefFrom({ ...base, memories: mem("combat.fight", -0.8, 0.8, 0) });
    expect(hit.threat).toBeGreaterThan(0.4);
  });
});
