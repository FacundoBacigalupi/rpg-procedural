import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import { laborGrams, planRebuild, rebuildNeed } from "./rebuild.ts";
import type { BuildingComponent } from "./tables.ts";

const old = "event:1" as EventId;
const built = "event:9" as EventId;
const comp = (part: BuildingComponent["part"], material: string, area: number) =>
  ({
    part,
    area,
    materials: [{ material, grams: 1, origin: old }],
    condition: 0.1,
    quality: 0.5,
    defects: [{ kind: "rot", severity: 0.4 }],
  }) as BuildingComponent;
const house = [comp("walls", "timber", 10), comp("roof", "thatch", 10)];
const g = (m: string) => (m === "timber" ? 1000 : 100);

describe("reconstrucción", () => {
  it("el trabajo crece con adultos, días y vecinos (con tope)", () => {
    expect(laborGrams(2, 0, 10)).toBe(2 * 10 * 40_000);
    expect(laborGrams(2, 3, 10)).toBeGreaterThan(laborGrams(2, 0, 10));
    expect(laborGrams(2, 100, 10)).toBe(laborGrams(2, 4, 10));
  });
  it("mejor pide más, distinto menos", () => {
    const total = (c: "same" | "better" | "different") =>
      rebuildNeed(house, c, g).reduce((s, n) => s + n.grams, 0);
    expect(total("better")).toBeGreaterThan(total("same"));
    expect(total("different")).toBeLessThan(total("same"));
  });
  it("sin salvado ni trabajo no se levanta", () => {
    expect(
      planRebuild({
        old: house,
        choice: "same",
        gramsPerM2: g,
        stock: new Map(),
        labor: 100,
        built,
      }),
    ).toBeUndefined();
  });
  it("lo salvado conserva su origen, lo nuevo el del evento, y los gramos cierran", () => {
    const plan = planRebuild({
      old: house,
      choice: "same",
      gramsPerM2: g,
      stock: new Map([["timber", 4000]]),
      labor: 1_000_000,
      built,
    });
    if (!plan) throw new Error("debía alcanzar");
    const walls = plan.components[0] as BuildingComponent;
    expect(walls.materials).toEqual([
      { material: "timber", grams: 4000, origin: old },
      { material: "timber", grams: 6000, origin: built },
    ]);
    expect(plan.salvaged.get("timber")).toBe(4000);
    expect(plan.gathered.get("timber")).toBe(6000);
    expect(plan.gathered.get("thatch")).toBe(1000);
    expect(walls.defects[0]?.severity).toBe(0.16);
    expect(plan.components[1]?.defects[0]?.severity).toBe(0);
  });
});
