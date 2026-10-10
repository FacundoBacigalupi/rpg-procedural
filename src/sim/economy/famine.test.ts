import { describe, expect, it } from "vitest";
import {
  daysOfFood,
  FAMINE_PRICE_PUSH,
  famineDischarge,
  famineState,
  scarcityReading,
  scarcityValue,
} from "./famine.ts";

const none = () => 0;

describe("hambruna: presión de escasez", () => {
  it("sin comida ni cosecha la presión es 1, con de sobra es 0", () => {
    expect(scarcityValue({ stockGrams: 0, harvestGramsOnDay: none, eatenPerDay: 100 })).toBe(1);
    expect(scarcityValue({ stockGrams: 1e9, harvestGramsOnDay: none, eatenPerDay: 100 })).toBe(0);
  });

  it("la cosecha esperada alivia: más cosecha, menos presión", () => {
    const base = { stockGrams: 5000, eatenPerDay: 100, horizonDays: 100 };
    const poor = scarcityValue({ ...base, harvestGramsOnDay: none });
    const good = scarcityValue({ ...base, harvestGramsOnDay: (d) => (d === 40 ? 20000 : 0) });
    expect(daysOfFood({ ...base, harvestGramsOnDay: none })).toBe(50);
    expect(good).toBeLessThan(poor);
  });

  it("estado con histéresis y descarga acotada, sin empuje si no hay escasez", () => {
    expect(famineState(0.2)).toBe("none");
    expect(famineState(0.5)).toBe("scarcity");
    expect(famineState(0.9)).toBe("famine");
    expect(famineState(0.66, "famine")).toBe("famine");
    expect(famineState(0.66, "scarcity")).toBe("scarcity");
    expect(famineDischarge(0.1, "none")).toEqual({ state: "none", pricePush: 1, migrationPull: 0 });
    const d = famineDischarge(1, "famine");
    expect(d.pricePush).toBeCloseTo(FAMINE_PRICE_PUSH);
    expect(d.migrationPull).toBeGreaterThan(0);
  });

  it("la lectura es una presión hunger de comunidad en 0..1", () => {
    const r = scarcityReading({
      community: "settlement:1" as never,
      balance: { stockGrams: 100, harvestGramsOnDay: none, eatenPerDay: 100 },
      sources: [],
      system: "economy",
    });
    expect(r.kind).toBe("hunger");
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThanOrEqual(1);
  });
});
