import { describe, expect, it } from "vitest";
import { externalAccount, ledgerUnit } from "../../core/index.ts";
import {
  batchesPossible,
  meanIncomePerDay,
  pooledCollection,
  productionTransfers,
  type TradeRecipe,
  wageDue,
  wagePerDay,
} from "./index.ts";

const loom: TradeRecipe = {
  id: "weave",
  hoursPerBatch: 5,
  inputs: [{ good: "wool", amount: 400 }],
  output: { good: "cloth", amount: 300 },
};

describe("oficios por hogar", () => {
  it("los lotes los limitan las horas o el insumo", () => {
    expect(batchesPossible(loom, 10, new Map([["wool", 5000]]))).toBe(2);
    expect(batchesPossible(loom, 100, new Map([["wool", 900]]))).toBe(2);
    expect(batchesPossible(loom, 100, new Map())).toBe(0);
  });

  it("producir conserva: insumo al sumidero, producto desde la fuente", () => {
    const acc = {
      workshop: externalAccount("taller"),
      sink: externalAccount("merma"),
      source: externalAccount("fuente"),
      unitOf: (g: string) => ledgerUnit(`good:${g}`),
    };
    const t = productionTransfers(loom, 2, acc);
    expect(t).toHaveLength(2);
    expect(t[0]?.amount).toBe(800);
    expect(t[1]?.amount).toBe(600);
    expect(productionTransfers(loom, 0, acc)).toEqual([]);
  });

  it("el jornal sube con la falta de brazos y no se paga más de lo que hay", () => {
    expect(wagePerDay(10, 10, 20)).toBeGreaterThan(wagePerDay(10, 10, 10));
    expect(wagePerDay(10, 20, 10)).toBeLessThan(wagePerDay(10, 10, 10));
    expect(wageDue(10, 10, 4)).toBe(4);
    expect(wageDue(10, 5, 100)).toBe(5);
  });

  it("el ingreso medio sale de recibos de la ventana y la bolsa común conserva", () => {
    const r = [
      { day: 1, coins: 30 },
      { day: 9, coins: 20 },
      { day: 10, coins: 10 },
    ];
    expect(meanIncomePerDay(r, 10, 5)).toBe(6);
    const a = externalAccount("a");
    const b = externalAccount("b");
    const home = externalAccount("casa");
    const c = pooledCollection(ledgerUnit("coin:copper"), home, [
      { id: "a", account: a, coins: 20, pooled: 0.5 },
      { id: "b", account: b, coins: 7, pooled: 1 },
    ]);
    expect(c.pot).toBe(17);
    expect(c.transfers.reduce((n, t) => n + t.amount, 0)).toBe(c.pot);
  });
});
