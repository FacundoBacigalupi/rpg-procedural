import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef, Seed } from "../../core/index.ts";
import {
  BODY_STATE,
  type Body,
  emptyMental,
  LOCATION,
  MEMORIES,
  MENTAL,
  type Memory,
  openCondition,
  PERSON,
  type ProcessContext,
  type StateChange,
  WorldTruth,
} from "../../sim/index.ts";
import { INTRUSION_HOURLY, intrusionProcess } from "./intrusion.ts";

const ME = "agent:1" as AgentId;
const THEM = "agent:2" as AgentId;
const CAUSE = "event:7" as EventId;
const PLACE = { kind: "cell", hex: 1 } as unknown as PlaceRef;
const awake = { activity: "rest", consciousness: "alert", death: null } as unknown as Body;

function world(withThem: boolean, asleep = false) {
  const t = new WorldTruth();
  for (const id of withThem ? [ME, THEM] : [ME]) {
    t.set(PERSON, id, {} as never);
    t.set(LOCATION, id, { hex: 1, space: "house" } as never);
    t.set(BODY_STATE, id, asleep ? ({ ...awake, activity: "sleep" } as Body) : awake);
  }
  t.set(MENTAL, ME, openCondition(emptyMental(CAUSE, 0), "trauma", 1, CAUSE, { who: THEM }, 0));
  t.set(MEMORIES, ME, {
    items: [{ eventId: CAUSE, salience: 0.2, measured: 0, lastRecalled: 0, recalls: 0 } as Memory],
    gists: [],
  });
  return t;
}

function hours(t: WorldTruth, n: number) {
  const p = intrusionProcess({ seed: 5 as unknown as Seed, placeOf: () => PLACE });
  let events = 0;
  let changes: readonly StateChange[] = [];
  for (let h = 1; h <= n; h++) {
    const out = p.run({ now: h * 3600, truth: t, scope: "world" } as unknown as ProcessContext);
    if (out?.events?.length) {
      events += out.events.length;
      changes = out.changes ?? [];
      for (const e of out.events) expect(e.causes).toEqual([{ kind: "event", event: CAUSE }]);
      break;
    }
  }
  return { events, changes };
}

describe("intrusión despierta", () => {
  it("quien comparte el sitio con el disparador acaba con un recuerdo intrusivo con causa", () => {
    // Chance por hora = 0.7 × 0.12 ≈ 0.08: en 200 horas es casi seguro (y determinista por seed).
    expect(INTRUSION_HOURLY).toBeGreaterThan(0);
    const r = hours(world(true), 200);
    expect(r.events).toBe(1);
    expect(r.changes.length).toBe(1);
  });

  it("sin el disparador delante, o dormido, no hay intrusión", () => {
    expect(hours(world(false), 200).events).toBe(0);
    expect(hours(world(true, true), 200).events).toBe(0);
  });
});
