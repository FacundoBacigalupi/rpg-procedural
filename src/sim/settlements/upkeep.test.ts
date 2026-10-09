import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import type { MaterialDef } from "./defs.ts";
import type { BuildingComponent } from "./tables.ts";
import {
  doorBarrier,
  jammedDoor,
  needsRepair,
  repairedCondition,
  repairedDefects,
  replacedGrams,
  replacedShare,
  wallBarrier,
  wornCondition,
} from "./upkeep.ts";

const thatch: MaterialDef = {
  id: "thatch",
  name: "paja",
  source: "fields",
  gramsPerM2: 4000,
  decayPerYear: 0.12,
  wall: "paper_wall",
  fuel: 1.4,
};
const stone: MaterialDef = {
  ...thatch,
  id: "stone",
  decayPerYear: 0.004,
  wall: "stone_wall",
  fuel: 0,
};

const part = (
  p: BuildingComponent["part"],
  condition: number,
  mat = "thatch",
): BuildingComponent => ({
  part: p,
  area: 10,
  materials: [{ material: mat, grams: 1000, origin: "event:1" as EventId }],
  condition,
  quality: 0.7,
  defects: [],
});

const dry = { rainMm: 0, frost: false, windMs: 0 };

describe("deterioro y mantenimiento (puro)", () => {
  it("sin clima ni uso es la curva del material por año", () => {
    const next = wornCondition(part("roof", 1), thatch, 365, dry, 0);
    expect(next).toBeCloseTo(Math.exp(-0.12), 3);
  });

  it("la lluvia, la helada y los defectos gastan más; el uso gasta la puerta", () => {
    const base = wornCondition(part("roof", 1), thatch, 30, dry, 0);
    expect(wornCondition(part("roof", 1), thatch, 30, { ...dry, rainMm: 20 }, 0)).toBeLessThan(
      base,
    );
    expect(wornCondition(part("walls", 1), thatch, 30, { ...dry, frost: true }, 0)).toBeLessThan(
      wornCondition(part("walls", 1), thatch, 30, dry, 0),
    );
    const flawed = { ...part("roof", 1), defects: [{ kind: "rot" as const, severity: 0.4 }] };
    expect(wornCondition(flawed, thatch, 30, dry, 0)).toBeLessThan(base);
    expect(wornCondition(part("door", 1), thatch, 30, dry, 1)).toBeLessThan(
      wornCondition(part("door", 1), thatch, 30, dry, 0),
    );
  });

  it("la piedra casi no se gasta y es determinista", () => {
    const a = wornCondition(part("walls", 1, "stone"), stone, 365, dry, 0);
    expect(a).toBeGreaterThan(0.99);
    expect(wornCondition(part("walls", 1, "stone"), stone, 365, dry, 0)).toBe(a);
  });

  it("pide arreglo lo gastado, el más gastado primero", () => {
    const list = needsRepair([part("roof", 0.5), part("walls", 0.9), part("door", 0.2)]);
    expect(list.map((c) => c.part)).toEqual(["door", "roof"]);
  });

  it("reparar cambia una parte, que sube la condición y baja los defectos", () => {
    const share = replacedShare(0.4, 0.5);
    expect(share).toBeGreaterThan(0.3);
    expect(repairedCondition(0.4, share)).toBeGreaterThan(0.4);
    expect(repairedCondition(0.9, 1)).toBe(1);
    expect(replacedGrams(1000, 0.25)).toBe(250);
    expect(repairedDefects([{ kind: "crack", severity: 0.3 }], 1)).toEqual([]);
  });

  it("puertas y paredes dan barreras", () => {
    expect(doorBarrier("open")).toBe("doorway");
    expect(doorBarrier("jammed")).toBe("door_closed");
    expect(jammedDoor(part("door", 0.2), 3)).toBe(true);
    expect(jammedDoor(part("door", 0.2), 0)).toBe(false);
    const materials = new Map([thatch, stone].map((m) => [m.id, m]));
    expect(wallBarrier([part("walls", 1, "stone")], materials)).toBe("stone_wall");
    expect(wallBarrier([part("walls", 1)], materials)).toBe("paper_wall");
  });
});
