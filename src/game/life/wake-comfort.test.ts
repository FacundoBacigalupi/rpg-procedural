import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import { WAKE_COMFORT_CAPACITY, wakeComfortFor, withWakeComfort } from "./wake.ts";

const ev = (n: number) => `event:${n}` as EventId;
const dead = "person:1" as AgentId;
const other = "person:2" as AgentId;

describe("consuelo del velorio como apoyo", () => {
  it("la condición ligada a la muerte (por evento o por disparador) lee el consuelo", () => {
    const w = withWakeComfort(undefined, ev(1), dead, 0.6);
    expect(wakeComfortFor(w, { originEventIds: [ev(1)], triggers: [] })).toBe(0.6);
    expect(wakeComfortFor(w, { originEventIds: [ev(9)], triggers: [{ who: dead }] })).toBe(0.6);
    expect(wakeComfortFor(w, { originEventIds: [ev(9)], triggers: [{ who: other }] })).toBe(
      undefined,
    );
    expect(wakeComfortFor(undefined, { originEventIds: [ev(1)], triggers: [] })).toBe(undefined);
  });

  it("guarda los últimos velorios y es determinista", () => {
    let w = withWakeComfort(undefined, ev(0), dead, 0.1);
    for (let i = 1; i <= WAKE_COMFORT_CAPACITY + 2; i++) w = withWakeComfort(w, ev(i), dead, 0.2);
    expect(w.items.length).toBe(WAKE_COMFORT_CAPACITY);
    expect(w.items.some((i) => i.event === ev(0))).toBe(false);
  });
});
