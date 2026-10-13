import { describe, expect, it } from "vitest";
import type { Event } from "../../core/index.ts";
import {
  type ProcessMeasurement,
  profileDemography,
  recordProcess,
  validateFullProfileConfig,
} from "./full-profile.ts";

describe("full-profile: configuración y reporte sin Life", () => {
  it("rechaza duraciones y cadencias que pueden no avanzar o crecer sin límite", () => {
    const base = { seeds: [1, 2], years: 2, checkEveryDays: 30 };
    expect(validateFullProfileConfig(base)).toBe(base);
    for (const patch of [
      { seeds: [] },
      { seeds: [-1] },
      { seeds: [NaN] },
      { years: Infinity },
      { years: 0 },
      { checkEveryDays: 0 },
      { checkEveryDays: 0.5 },
      { days: -1 },
      { frequency: 0 },
    ])
      expect(() => validateFullProfileConfig({ ...base, ...patch })).toThrow(RangeError);
  });

  it("distingue invocaciones del scheduler y trabajo efectivo", () => {
    const counts = new Map<string, ProcessMeasurement>();
    recordProcess(counts, "life.routine", 0, 0);
    recordProcess(counts, "life.routine", 3, 0);
    recordProcess(counts, "life.routine", 0, 2);
    expect(counts.get("life.routine")).toEqual({
      calls: 3,
      effectiveCalls: 2,
      changes: 3,
      events: 2,
    });
  });

  it("cuenta nacimientos y muertes durante la corrida sin mezclar la historia inicial", () => {
    const event = (tick: number, kind: string, cause?: string) =>
      ({ tick, kind, data: { cause } }) as Event;
    const metrics = profileDemography(
      [
        event(1, "family.birth"),
        event(10, "body.died", "hunger"),
        event(11, "family.birth"),
        event(12, "body.died", "thirst"),
        event(13, "body.died", "thirst"),
        event(14, "npc.goal"),
      ],
      10,
    );
    expect(metrics).toEqual({
      births: 1,
      deaths: 2,
      deathsByCause: { thirst: 2 },
      eventsByKind: { "body.died": 2, "family.birth": 1, "npc.goal": 1 },
    });
  });
});
