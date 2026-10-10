import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import type { ReadonlyWorldTruth } from "../../sim/index.ts";
import {
  ACCLIMATIZATION,
  type BodyCapabilities,
  LOCATION,
  type LocalMap,
  type SpaceGraph,
  TRAVEL_CELL,
} from "../../sim/index.ts";
import { applyAltitude, mapAltitudeOf, travelAltitudeOf, travelCellAltitude } from "./altitude.ts";

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

  it("suma la altura del piso del espacio", () => {
    const spaces = { spaces: [{ key: "tower", heightM: 30 }], edges: [] } as unknown as SpaceGraph;
    const f = mapAltitudeOf(map, spaces);
    const at = (space?: string) =>
      ({
        get: (t: { name: string }) => (t.name === LOCATION.name ? { hex: 0, space } : undefined),
      }) as unknown as ReadonlyWorldTruth;
    expect(f(at("tower"), who)).toBe(130);
    expect(f(at("other"), who)).toBe(100);
    expect(f(at(), who)).toBe(100);
  });

  it("de viaje usa la elevación de la celda recorrida; en el parche, la local", () => {
    const f = travelAltitudeOf(map, {
      cellOf: (t) => (t.get(LOCATION, who)?.hex === 1 ? 7 : undefined),
      elevationM: (c) => (c === 7 ? 3200 : -50),
    });
    expect(f(truthAt(0), who)).toBe(100);
    expect(f(truthAt(1), who)).toBe(3200);
    const sea = travelAltitudeOf(map, { cellOf: () => 1, elevationM: () => -50 });
    expect(sea(truthAt(0), who)).toBe(0);
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

describe("celda de viaje en la tabla", () => {
  it("sin fila usa el parche; con fila, la elevación de la celda", () => {
    const f = travelAltitudeOf(
      map,
      travelCellAltitude((c) => (c === 9 ? 5000 : 0)),
    );
    const at = (cell?: number) =>
      ({
        get: (t: { name: string }) =>
          t.name === LOCATION.name
            ? { hex: 0 }
            : t.name === TRAVEL_CELL.name && cell !== undefined
              ? { cell, since: 0 }
              : undefined,
      }) as unknown as ReadonlyWorldTruth;
    expect(f(at(), who)).toBe(100);
    expect(f(at(9), who)).toBe(5000);
  });
});
