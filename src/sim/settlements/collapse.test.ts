import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import { collapseCheck, type LoadInput, rebuildChoice, salvagedGrams } from "./collapse.ts";
import type { BuildingComponent } from "./tables.ts";

const origin = { kind: "event", event: "event:1" as EventId } as never;
const part = (p: BuildingComponent["part"], condition: number): BuildingComponent => ({
  part: p,
  area: 10,
  materials: [{ material: "thatch", grams: 1000, origin }],
  condition,
  quality: 0.5,
  defects: [],
});
const none: LoadInput = { rainMm: 0, snowMm: 0, windMs: 0, quake: 0, weight: 0 };

describe("derrumbe con causa", () => {
  it("sin carga no cae por gastado que esté", () => {
    expect(collapseCheck([part("roof", 0.05)], none)).toBeUndefined();
  });
  it("con carga pero sano no cae", () => {
    expect(collapseCheck([part("roof", 0.9)], { ...none, rainMm: 60, windMs: 25 })).toBeUndefined();
  });
  it("gastado y con lluvia fuerte cae, y la causa es la lluvia", () => {
    const c = collapseCheck([part("roof", 0.1), part("walls", 0.8)], { ...none, rainMm: 40 });
    expect(c?.part).toBe("roof");
    expect(c?.cause).toBe("rain");
    expect(c?.risk).toBeGreaterThan(0);
  });
  it("el sismo derriba paredes gastadas", () => {
    const c = collapseCheck([part("walls", 0.1)], { ...none, quake: 0.8 });
    expect(c?.cause).toBe("quake");
  });
  it("lo salvado nunca pasa de lo que había y el sismo salva menos", () => {
    expect(salvagedGrams(1000, 0.2, false)).toBeLessThanOrEqual(1000);
    expect(salvagedGrams(1000, 0.2, true)).toBeLessThan(salvagedGrams(1000, 0.2, false));
  });
  it("reconstruir: otro lugar si el sitio es inseguro, mejor si sobra, distinto si falta", () => {
    const base = { neededGrams: 1000, salvagedGrams: 300, savingsGrams: 0, helpGrams: 0 };
    expect(rebuildChoice({ ...base, siteUnsafe: true })).toBe("elsewhere");
    expect(rebuildChoice({ ...base, savingsGrams: 1200, siteUnsafe: false })).toBe("better");
    expect(rebuildChoice({ ...base, savingsGrams: 700, siteUnsafe: false })).toBe("same");
    expect(rebuildChoice({ ...base, siteUnsafe: false })).toBe("different");
  });
});
