import { describe, expect, it } from "vitest";
import { LOT_QUALITY, qualityOfUnit, REFERENCE_QUALITY, receiveLot } from "./index.ts";

describe("calidad por lote de cada agente", () => {
  it("sin registro vale la referencia", () => {
    expect(qualityOfUnit(undefined, "good:bread")).toBe(REFERENCE_QUALITY);
  });

  it("el primer lote fija la calidad y los siguientes se promedian por gramos", () => {
    const a = receiveLot(undefined, "good:bread", 0, 500, 0.9);
    expect(a["good:bread"]).toBeCloseTo(0.9, 3);
    const b = receiveLot(a, "good:bread", 500, 500, 0.5);
    expect(b["good:bread"]).toBeCloseTo(0.7, 3);
  });

  it("lo que tenía sin registro cuenta como referencia al mezclar", () => {
    const b = receiveLot(undefined, "good:bread", 1000, 1000, 0.9);
    expect(b["good:bread"]).toBeCloseTo(0.8, 3);
  });

  it("la tabla tiene nombre propio", () => {
    expect(LOT_QUALITY.name).toBe("economy.lot_quality");
  });
});
