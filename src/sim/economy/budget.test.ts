import { describe, expect, it } from "vitest";
import {
  availableCoins,
  type HouseholdFlows,
  netPerDay,
  poolIncome,
  runwayDays,
  spendCeiling,
  standing,
} from "./index.ts";

const base: HouseholdFlows = {
  coins: 300,
  incomePerDay: 6,
  fixedPerDay: 2,
  foodCoinsPerAdultDay: 3,
  pantryDays: 0,
  adults: 2,
  children: 1,
  elders: 0,
};

describe("presupuesto del hogar", () => {
  it("sin despensa propia la comida se compra y el neto baja", () => {
    expect(netPerDay(base)).toBeLessThan(netPerDay({ ...base, pantryDays: 90 }));
  });

  it("un hogar que gasta más de lo que entra tiene un horizonte finito", () => {
    expect(runwayDays(base)).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(standing({ ...base, coins: 0, pantryDays: 0 })).toBe("broke");
    expect(standing({ ...base, pantryDays: 90 })).toBe("comfortable");
  });

  it("lo no urgente no toca la reserva de comida; lo urgente sí", () => {
    expect(availableCoins(base)).toBeLessThan(base.coins);
    expect(spendCeiling(base, false)).toBeLessThan(spendCeiling(base, true));
  });

  it("aportar a la bolsa común conserva el total", () => {
    const earned = [
      { id: "a", coins: 17, pooled: 0.5 },
      { id: "b", coins: 9, pooled: 1 },
    ];
    const { pot, kept } = poolIncome(earned);
    const keptSum = [...kept.values()].reduce((s, x) => s + x, 0);
    expect(pot + keptSum).toBe(26);
  });
});
