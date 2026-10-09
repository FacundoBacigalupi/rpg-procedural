import { describe, expect, it } from "vitest";
import { fieldYield, startingParcel, stepParcelField, tiredNutrient } from "./parcelField.ts";
import { SOIL_START } from "./soil.ts";

const calm = { days: 1, load: 0, heavyRainDays: 0, arid: false };

describe("suelo de la aldea por parcela", () => {
  it("arranca rindiendo lo que el suelo único", () => {
    expect(fieldYield(startingParcel(SOIL_START))).toBeCloseTo(SOIL_START, 10);
  });

  it("con la cosecha de siempre se asienta cerca de donde empezó", () => {
    let s = startingParcel(SOIL_START);
    for (let d = 0; d < 1500; d++) s = stepParcelField(s, { ...calm, load: 1 });
    expect(fieldYield(s)).toBeGreaterThan(0.75);
    expect(fieldYield(s)).toBeLessThan(0.95);
  });

  it("exprimirlo cansa el campo y el descanso lo devuelve", () => {
    let s = startingParcel(0.45);
    const tired = fieldYield(s);
    expect(tiredNutrient(s)).toBe("n");
    expect(tiredNutrient(startingParcel(0.9))).toBeUndefined();
    for (let d = 0; d < 800; d++) s = stepParcelField(s, calm);
    expect(fieldYield(s)).toBeGreaterThan(tired + 0.2);
  });

  it("la lluvia fuerte erosiona y no vuelve; un tramo largo da lo mismo que días sueltos", () => {
    const s0 = startingParcel(0.9);
    const rainy = stepParcelField(s0, { ...calm, days: 30, heavyRainDays: 20 });
    expect(rainy.depth).toBeLessThan(s0.depth);
    const dry = stepParcelField(rainy, { ...calm, days: 300 });
    expect(dry.depth).toBe(rainy.depth);
  });
});
