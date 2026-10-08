import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef, PlanetClock, Seed } from "../../core/index.ts";
import {
  BODY_STATE,
  type Body,
  ENTITY,
  formMemory,
  MEMORIES,
  type Memory,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import {
  discomfortOf,
  fearOf,
  MIN_SLEEP_HOURS,
  SLEEP_STATE,
  type SleepOptions,
  sleepProcess,
  themeOfMemory,
} from "./sleep.ts";

const HOUR = 3600;
const A = "agent:1" as AgentId;
const PLACE = { kind: "none" } as unknown as PlaceRef;
const CLOCK = { day: 86_400, year: 86_400 * 360 } as unknown as PlanetClock;

const body = (activity: "sleep" | "light", wounds: Body["wounds"] = []): Body =>
  ({
    activity,
    consciousness: "alert",
    death: null,
    wounds,
  }) as unknown as Body;

const opts = (seed: number): SleepOptions => ({
  clock: CLOCK,
  seed: seed as unknown as Seed,
  schemas: [],
  dims: [],
  bonds: [],
  placeOf: () => PLACE,
});

function world(b: Body, memories?: readonly Memory[]) {
  const truth = new WorldTruth();
  truth.set(ENTITY, A, { endedAt: undefined } as never);
  truth.set(PERSON, A, { born: 0 } as never);
  truth.set(BODY_STATE, A, b);
  if (memories) truth.set(MEMORIES, A, { items: memories, gists: [] });
  return truth;
}

const ctx = (truth: WorldTruth, now: number, window = HOUR) =>
  ({ scope: A, truth, now, window }) as unknown as ProcessContext;

function memory(i: number, intensity: number): Memory {
  return formMemory({
    eventId: `event:${i}` as EventId,
    kind: "combat.fight",
    with: [`agent:${i + 10}` as AgentId],
    place: PLACE,
    at: 0,
    intensity,
    valence: -0.6,
  });
}

describe("sueño que consolida", () => {
  it("la incomodidad sube con el frío, el calor y las heridas abiertas", () => {
    expect(discomfortOf(18, { wounds: [] })).toBe(0);
    expect(discomfortOf(-5, { wounds: [] })).toBe(1);
    expect(discomfortOf(40, { wounds: [] })).toBe(1);
    const hurt = { wounds: [{ stage: "open", severity: 0.5 }] } as unknown as Body;
    expect(discomfortOf(18, hurt)).toBeCloseTo(0.4);
    const healed = { wounds: [{ stage: "healed", severity: 0.9 }] } as unknown as Body;
    expect(discomfortOf(18, healed)).toBe(0);
  });

  it("el susto es una herida nueva durante el sueño", () => {
    const b = { wounds: [{ at: 100, severity: 0.4 }] } as unknown as Body;
    expect(fearOf(b, 50)).toBeCloseTo(0.7);
    expect(fearOf(b, 200)).toBe(0);
  });

  it("el tema sale del tipo de evento y la valencia", () => {
    const m = (kind: string, valence: number) =>
      ({ perceived: { kind }, valence }) as unknown as Memory;
    expect(themeOfMemory(m("combat.fight", -0.8))).toBe("violence");
    expect(themeOfMemory(m("action.give", 0.5))).toBe("kindness");
    expect(themeOfMemory(m("body.died", -1))).toBe("loss");
    expect(themeOfMemory(m("action.speak", 0))).toBeUndefined();
  });

  it("dormir lleva la cuenta y despertar tras una noche consolida y la deja como evento", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const p = sleepProcess(opts(seed));
        let truth = world(body("sleep"), [memory(1, 0.9), memory(2, 0.1)]);
        const base = 22 * HOUR;
        for (let h = 1; h <= 8; h++) {
          const r = p.run(ctx(truth, base + h * HOUR));
          for (const c of r.changes ?? []) {
            if (c.op === "set") truth.set(SLEEP_STATE, A, c.value as never);
          }
        }
        const st = truth.get(SLEEP_STATE, A);
        expect(st?.hours).toBe(8);
        expect(st && st.hours >= MIN_SLEEP_HOURS).toBe(true);

        truth.set(BODY_STATE, A, body("light"));
        const wake = p.run(ctx(truth, base + 9 * HOUR));
        expect(wake.events).toHaveLength(1);
        expect(wake.events?.[0]?.kind).toBe("mind.consolidated");
        expect(wake.events?.[0]?.causes.length).toBeGreaterThan(0);
        expect(wake.changes?.some((c) => c.op === "delete" && c.table === SLEEP_STATE.name)).toBe(
          true,
        );
        expect(wake.changes?.some((c) => c.op === "set" && c.table === MEMORIES.name)).toBe(true);

        // Determinista: mismo seed y mismo estado, misma pasada.
        expect(p.run(ctx(truth, base + 9 * HOUR))).toEqual(wake);
        truth = world(body("light"));
      }),
      { numRuns: 20 },
    );
  });

  it("una siesta corta no consolida y no deja cuenta", () => {
    const p = sleepProcess(opts(1));
    const truth = world(body("light"), [memory(1, 0.9)]);
    truth.set(SLEEP_STATE, A, {
      since: 0,
      mark: HOUR,
      hours: 1,
      discomfortHours: 0,
      fear: 0,
    });
    const r = p.run(ctx(truth, 2 * HOUR));
    expect(r.events).toBeUndefined();
    expect(r.changes).toHaveLength(1);
    expect(r.changes?.[0]?.op).toBe("delete");
  });

  it("despierto y sin cuenta no hace nada", () => {
    const p = sleepProcess(opts(1));
    expect(p.run(ctx(world(body("light")), HOUR))).toEqual({});
  });
});
