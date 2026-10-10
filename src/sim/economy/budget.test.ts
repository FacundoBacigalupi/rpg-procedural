import { describe, expect, it } from "vitest";
import {
  availableCoins,
  BASE_POOL_SHARE,
  type HouseholdFlows,
  netPerDay,
  POOL_SHARE_MAX,
  POOL_SHARE_MIN,
  personalPoolShare,
  poolIncome,
  runwayDays,
  spendCeiling,
  standing,
  withRentIncome,
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

describe("renta cobrada", () => {
  it("suma al ingreso solo mientras está vigente; sin rentas no cambia nada", () => {
    const rents = [
      { perDay: 4, fromDay: 10, untilDay: 20 },
      { perDay: 1, fromDay: 0 },
    ];
    expect(withRentIncome(base, [], 5)).toBe(base);
    expect(withRentIncome(base, rents, 5).incomePerDay).toBe(base.incomePerDay + 1);
    expect(withRentIncome(base, rents, 15).incomePerDay).toBe(base.incomePerDay + 5);
    expect(withRentIncome(base, rents, 20).incomePerDay).toBe(base.incomePerDay + 1);
  });
});

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

describe("aporte personal a la bolsa común", () => {
  const home = { adults: 2, children: 0, elders: 0 };

  it("sin temperamento ni dependientes es el 70% de siempre", () => {
    expect(personalPoolShare({}, home)).toBeCloseTo(BASE_POOL_SHARE, 10);
  });

  it("el cálido da más, el de guardar da menos, y los dependientes suben el aporte", () => {
    expect(personalPoolShare({ warmth: 1 }, home)).toBeGreaterThan(personalPoolShare({}, home));
    expect(personalPoolShare({ control: 1 }, home)).toBeLessThan(personalPoolShare({}, home));
    expect(personalPoolShare({}, { adults: 1, children: 2, elders: 1 })).toBeGreaterThan(
      personalPoolShare({}, home),
    );
  });

  it("queda entre el piso y el techo", () => {
    const hungry = { adults: 1, children: 9, elders: 9 };
    expect(personalPoolShare({ warmth: 9, control: -9 }, hungry)).toBe(POOL_SHARE_MAX);
    expect(personalPoolShare({ warmth: -9, control: 9 }, home)).toBeGreaterThanOrEqual(
      POOL_SHARE_MIN,
    );
  });
});
