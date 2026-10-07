import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gramsIn, rotFraction, strike } from "./index.ts";

describe("economía mínima", () => {
  it("la mitad se pudre a la vida media", () => {
    expect(rotFraction(10, 10)).toBeCloseTo(0.5, 10);
    expect(rotFraction(10, 0)).toBe(0);
  });

  it("sin zona de acuerdo no hay trato", () => {
    expect(
      strike({
        wantGrams: 1000,
        askPerKg: 10,
        maxPerKg: 5,
        edge: 0,
        availableGrams: 5000,
        buyerCoins: 100,
        actorBuys: true,
      }),
    ).toBeNull();
  });

  it("el trato nunca pasa de lo que hay ni de lo que se puede pagar", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        fc.boolean(),
        (want, avail, coins, edge, actorBuys) => {
          const d = strike({
            wantGrams: want,
            askPerKg: 4,
            maxPerKg: 8,
            edge,
            availableGrams: avail,
            buyerCoins: coins,
            actorBuys,
          });
          if (d === null) return true;
          return d.grams <= Math.min(want, avail) && d.coins <= coins && d.coins >= 1;
        },
      ),
    );
  });

  it("lee cantidades en kilos y gramos", () => {
    expect(gramsIn("3 kilos")).toBe(3000);
    expect(gramsIn("500 gramos")).toBe(500);
    expect(gramsIn(null)).toBe(1000);
  });
});
