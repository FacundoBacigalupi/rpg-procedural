import { describe, expect, it } from "vitest";
import {
  endOfDayAdjust,
  householdQuote,
  learnFromDeal,
  noteSeller,
  recordDeal,
  type TapeEntry,
  tapePrice,
} from "./index.ts";

const deal = (day: number, coins: number, grams = 1000): TapeEntry => ({
  day,
  unit: "good:grain",
  grams,
  coins,
  seller: "a",
  buyer: "b",
});

describe("mercado de la aldea", () => {
  it("la cinta saca la mediana y olvida lo viejo", () => {
    let t = recordDeal([], deal(1, 10));
    t = recordDeal(t, deal(1, 12));
    t = recordDeal(t, deal(2, 30));
    expect(tapePrice(t, "good:grain", 1, 2)).toBe(12);
    t = recordDeal(t, deal(100, 11));
    expect(t.length).toBe(1);
  });

  it("el testigo aprende menos que la parte", () => {
    const e = deal(3, 20);
    const party = learnFromDeal(undefined, e, 10, "party")["good:grain"]?.perKg ?? 0;
    const wit = learnFromDeal(undefined, e, 10, "witness")["good:grain"]?.perKg ?? 0;
    expect(party).toBeGreaterThan(wit);
    expect(wit).toBeGreaterThan(10);
  });

  it("vender todo sube la creencia y no vender baja; el pedido sigue a la creencia", () => {
    const up = endOfDayAdjust(undefined, "good:grain", 10, 5, {
      offeredGrams: 1000,
      soldGrams: 1000,
      walkedAway: 0,
    });
    const down = endOfDayAdjust(undefined, "good:grain", 10, 5, {
      offeredGrams: 1000,
      soldGrams: 0,
      walkedAway: 2,
    });
    expect(up["good:grain"]?.perKg).toBeGreaterThan(10);
    expect(down["good:grain"]?.perKg).toBeLessThan(10);
    expect(householdQuote(up, "good:grain", 10, 5, 100).ask).toBeGreaterThan(
      householdQuote(down, "good:grain", 10, 5, 100).ask,
    );
  });
});

describe("cotización con calidad y comida encima", () => {
  it("la calidad escala pedido y oferta, y quien casi no carga comida ofrece más", () => {
    const plain = householdQuote(undefined, "good:grain", 10, 5, 10);
    const fine = householdQuote(undefined, "good:grain", 10, 5, 10, { quality: 1.2 });
    expect(fine.ask).toBeCloseTo(plain.ask * 1.2, 9);
    expect(fine.bid).toBeCloseTo(plain.bid * 1.2, 9);
    const bare = householdQuote(undefined, "good:grain", 10, 5, 10, { carryDays: 0 });
    expect(bare.bid).toBeGreaterThan(plain.bid);
    expect(bare.ask).toBe(plain.ask);
  });
});

describe("libro del día del vendedor", () => {
  it("suma lo ofrecido y lo vendido en el mismo día y arranca otro libro al cambiar de día", () => {
    const a = noteSeller(undefined, 5, "good:grain", 2000, 0);
    const b = noteSeller(a, 5, "good:grain", 1000, 1000);
    expect(b.rows["good:grain"]).toEqual({ offeredGrams: 3000, soldGrams: 1000, walkedAway: 1 });
    expect(noteSeller(b, 6, "good:grain", 500, 500).rows["good:grain"]?.offeredGrams).toBe(500);
  });
});
