import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import {
  AMPUTATIONS,
  type Amputations,
  amputationFactors,
  BODY_STATE,
  type BodyCapabilities,
  ENTITY,
  FROSTBITE,
  type FrostbiteState,
  NO_FROSTBITE,
  newAmputations,
  PERSON,
  type ReadonlyWorldTruth,
  stepCore,
  TEMPERATE,
  thermalDeath,
} from "../../sim/index.ts";
import { applyFrostbite, seasonalClothing, thermalProcess } from "./thermal.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };

describe("life.thermal", () => {
  it("la ropa de estación abriga más cuanto más frío", () => {
    expect(seasonalClothing(-10).clo).toBeGreaterThan(seasonalClothing(20).clo);
    expect(seasonalClothing(40).clo).toBeGreaterThanOrEqual(0.5);
  });

  it("con ropa de estación el clima templado deja el núcleo en lo normal", () => {
    let core = 37;
    for (let i = 0; i < 96; i++) {
      core = stepCore(core, 70, TEMPERATE, seasonalClothing(TEMPERATE.airC), 1, 1, 0.25).coreC;
    }
    expect(Math.abs(core - 37)).toBeLessThan(0.5);
    expect(thermalDeath(core)).toBeNull();
  });

  it("es un proceso diario de la vida", () => {
    const p = thermalProcess({
      clock,
      map: {} as never,
      spaces: { spaces: [] } as never,
      seed: 1 as never,
      placeOf: () => ({ kind: "cell", cell: "cell:1" }) as never,
    });
    expect(p.id).toBe("life.thermal");
    expect(p.cadence.local).toBe("day");
  });
});

describe("congelación: autocuidado", () => {
  const who = "agent:1" as AgentId;
  const climate = {
    cell: "c:1",
    latDeg: 45,
    axialTiltDeg: 23.4,
    annualMeanC: 24,
    seasonalRangeC: 2,
    annualPrecipMm: 800,
    windEast: 1,
    windNorth: 0.3,
  };
  const severityAfter = (care?: number): number => {
    const rows: Record<string, unknown> = {
      [PERSON.name]: {},
      [ENTITY.name]: { id: who },
      [BODY_STATE.name]: { massKg: 70, water: 3.5, activity: "rest", scars: [] },
      [FROSTBITE.name]: { ...NO_FROSTBITE, hands: 0.3 },
    };
    const truth = {
      ids: () => [who],
      get: (t: { name: string }) => rows[t.name],
    } as unknown as ReadonlyWorldTruth;
    const p = thermalProcess({
      clock,
      map: { cell: "c:1", lonDeg: 0, climate } as never,
      spaces: { spaces: [] } as never,
      seed: 1 as never,
      placeOf: () => ({ kind: "cell", cell: "cell:1" }) as never,
      frostbite: true,
      frostbiteTreatment: true,
      ...(care === undefined ? {} : { frostbiteSelfCare: { skillOf: () => care } }),
    });
    const out = p.run({ truth, now: clock.day * 10, window: clock.day } as never);
    const set = out.changes?.find((c) => c.table === FROSTBITE.name && c.op === "set");
    return (set as unknown as { value?: FrostbiteState } | undefined)?.value?.hands ?? 0;
  };

  it("sin médico se recalienta solo y la habilidad lo acelera", () => {
    const none = severityAfter();
    const novice = severityAfter(0);
    const expert = severityAfter(1);
    expect(novice).toBeLessThan(none);
    expect(expert).toBeLessThan(novice);
  });
});

describe("congelación cableada", () => {
  const who = "agent:1" as AgentId;
  const caps = { manipulation: 1, locomotion: 1, cognition: 1 } as unknown as BodyCapabilities;
  const truthWith = (frost?: FrostbiteState, lost?: Amputations): ReadonlyWorldTruth =>
    ({
      get: (table: { name: string }) =>
        table.name === FROSTBITE.name ? frost : table.name === AMPUTATIONS.name ? lost : undefined,
    }) as unknown as ReadonlyWorldTruth;

  it("sin filas no cambia las capacidades", () => {
    expect(applyFrostbite(caps, truthWith(), who)).toBe(caps);
  });

  it("manos y pies congelados bajan manipulación y locomoción", () => {
    const f = { ...NO_FROSTBITE, hands: 0.5, feet: 0.5 };
    const c = applyFrostbite(caps, truthWith(f), who);
    expect(c.manipulation).toBeLessThan(1);
    expect(c.locomotion).toBeLessThan(1);
    expect(c.cognition).toBe(1);
  });

  it("la amputación es permanente y se registra una sola vez", () => {
    const necrotic = { ...NO_FROSTBITE, hands: 0.9 };
    expect(newAmputations(necrotic, undefined)).toEqual(["hands"]);
    const lost = { lost: [{ part: "hands" as const, at: 5, cause: "event:1" as EventId }] };
    expect(newAmputations(necrotic, lost)).toEqual([]);
    expect(amputationFactors(lost).manipulation).toBeLessThan(1);
    expect(applyFrostbite(caps, truthWith(undefined, lost), who).manipulation).toBeLessThan(1);
  });
});
