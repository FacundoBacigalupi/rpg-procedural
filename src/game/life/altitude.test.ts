import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import type { ReadonlyWorldTruth } from "../../sim/index.ts";
import {
  ACCLIMATIZATION,
  type BodyCapabilities,
  LOCATION,
  type LocalMap,
} from "../../sim/index.ts";
import { applyAltitude, mapAltitudeOf } from "./altitude.ts";

const who = "agent:1" as AgentId;
const map = { elevationM: [100, 4500] } as unknown as LocalMap;
const caps = { cognition: 1, endurance: 1, sight: 1, hearing: 1 } as unknown as BodyCapabilities;

function truthAt(hex: number, level?: number): ReadonlyWorldTruth {
  return {
    get: (table: { name: string }) =>
      table.name === LOCATION.name
        ? { hex }
        : table.name === ACCLIMATIZATION.name && level !== undefined
          ? { level, at: 0 }
          : undefined,
  } as unknown as ReadonlyWorldTruth;
}

describe("altitud real", () => {
  it("lee la elevación del hex donde está", () => {
    const f = mapAltitudeOf(map);
    expect(f(truthAt(0), who)).toBe(100);
    expect(f(truthAt(1), who)).toBe(4500);
  });

  it("en el llano no cambia las capacidades; arriba baja la resistencia, menos aclimatado", () => {
    const f = mapAltitudeOf(map);
    expect(applyAltitude(caps, truthAt(0), who, f)).toBe(caps);
    const raw = applyAltitude(caps, truthAt(1), who, f).endurance;
    const acc = applyAltitude(caps, truthAt(1, 1), who, f).endurance;
    expect(raw).toBeLessThan(1);
    expect(acc).toBeGreaterThan(raw);
  });
});
