import { describe, expect, it } from "vitest";
import { chooseGarments, type GarmentDef, type OwnedGarment, wornGarment } from "./garments.ts";
import { dressed } from "./thermal.ts";

function def(id: string, slot: GarmentDef["slot"], layer: number, clo: number): GarmentDef {
  return {
    id,
    name: id,
    slot,
    layer,
    clo,
    windproof: 0.2,
    coverage: 0.3,
    material: "hemp",
    basic: true,
    wearDays: 365,
  };
}
const own = (d: GarmentDef, wear = 0): OwnedGarment => ({ def: d, wear });

const shirt = def("shirt", "base", 0, 0.3);
const pants = def("pants", "base", 0, 0.3);
const tunic = def("tunic", "body", 2, 0.5);
const coat = def("coat", "outer", 5, 1);
const all = [own(coat), own(tunic), own(pants), own(shirt)];
const ids = (gs: readonly OwnedGarment[]) => gs.map((g) => g.def.id);

describe("elegir qué ponerse (clothing-garments)", () => {
  it("con calor lleva solo la base, nunca anda desnudo", () => {
    expect(ids(chooseGarments(all, 0))).toEqual(["pants", "shirt"]);
  });

  it("con frío suma capas en orden hasta llegar", () => {
    expect(ids(chooseGarments(all, 1))).toEqual(["pants", "shirt", "tunic"]);
    expect(ids(chooseGarments(all, 1.2))).toEqual(["pants", "shirt", "tunic", "coat"]);
  });

  it("si no alcanza se pone todo; lo deshecho no se pone", () => {
    expect(chooseGarments(all, 9)).toHaveLength(4);
    expect(ids(chooseGarments([...all.slice(1), own(coat, 1)], 9))).toEqual([
      "pants",
      "shirt",
      "tunic",
    ]);
  });

  it("una prenda gastada abriga menos y obliga a sumar otra", () => {
    expect(wornGarment(own(tunic, 0.5)).clo).toBe(0.25);
    expect(wornGarment(own(tunic, 0.5)).coverage).toBe(0.3);
    const worn = [own(coat), own(tunic, 0.8), own(pants), own(shirt)];
    expect(ids(chooseGarments(worn, 1))).toEqual(["pants", "shirt", "tunic", "coat"]);
  });

  it("el abrigo de lo elegido es la suma de las prendas", () => {
    const c = dressed(chooseGarments(all, 1).map(wornGarment));
    expect(c.clo).toBeCloseTo(1.1);
  });

  it("no depende del orden en que se listan", () => {
    expect(ids(chooseGarments([...all].reverse(), 1.2))).toEqual(ids(chooseGarments(all, 1.2)));
  });
});
