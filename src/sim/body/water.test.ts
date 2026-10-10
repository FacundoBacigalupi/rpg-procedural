import { describe, expect, it } from "vitest";
import { effectiveLoad, netHydration, waterWarning } from "./nutrition.ts";
import { drinkWater, sourceWater, treatWater } from "./water.ts";

describe("agua por fuente y tratamiento", () => {
  it("la lluvia es limpia, el río con crecida es barroso y el mar es salado", () => {
    expect(sourceWater({ kind: "rain" }).load).toBeLessThan(0.05);
    const calm = sourceWater({ kind: "river", runoff: 0 });
    const flood = sourceWater({ kind: "river", runoff: 1 });
    expect(flood.turbidity).toBeGreaterThan(calm.turbidity);
    expect(sourceWater({ kind: "sea" }).salinity).toBeGreaterThan(0.5);
  });

  it("hervir mata la carga pero no aclara ni quita la sal; filtrar aclara", () => {
    const river = sourceWater({ kind: "river", load: 0.8, runoff: 1 });
    const boiled = treatWater(river, "boil");
    expect(effectiveLoad(boiled)).toBeLessThan(0.02);
    expect(boiled.turbidity).toBe(river.turbidity);
    expect(treatWater(river, "filter").turbidity).toBeLessThan(river.turbidity);
    const sea = treatWater(sourceWater({ kind: "sea" }), "boil_filter");
    expect(sea.salinity).toBe(sourceWater({ kind: "sea" }).salinity);
  });

  it("beber agua de mar deshidrata y avisa; el pozo hidrata", () => {
    const sea = sourceWater({ kind: "sea" });
    expect(drinkWater(1, sea).hydration).toBeLessThan(0);
    expect(drinkWater(1, sourceWater({ kind: "well" })).hydration).toBe(1);
    expect(netHydration(1, sea)).toBe(drinkWater(1, sea).hydration);
    expect(waterWarning(sea)).toBeGreaterThan(waterWarning(sourceWater({ kind: "well", load: 1 })));
  });
});
