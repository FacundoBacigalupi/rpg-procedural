import { describe, expect, it } from "vitest";
import { baseFor, observeDeal, PRICE_BELIEFS } from "./index.ts";

describe("creencias de precio por agente", () => {
  it("sin creencia, la base es la del contenido", () => {
    expect(baseFor(undefined, "good:grain", 10, 5)).toBe(10);
  });

  it("un trato caro corre la base hacia arriba y la fe sube", () => {
    const b = observeDeal(undefined, "good:grain", 20, 10, 5);
    const base = baseFor(b, "good:grain", 10, 5);
    expect(base).toBeGreaterThan(10);
    expect(base).toBeLessThan(20);
    const again = observeDeal(b, "good:grain", 20, 10, 6);
    expect(again["good:grain"]?.confidence).toBeGreaterThan(b["good:grain"]?.confidence ?? 1);
    expect(baseFor(again, "good:grain", 10, 6)).toBeGreaterThan(base);
  });

  it("con los años sin ver precios la base vuelve hacia la referencia", () => {
    const b = observeDeal(undefined, "good:grain", 20, 10, 5);
    expect(baseFor(b, "good:grain", 10, 5000)).toBeLessThan(baseFor(b, "good:grain", 10, 5));
  });

  it("la tabla tiene nombre propio", () => {
    expect(PRICE_BELIEFS.name).toBe("economy.price_beliefs");
  });
});
