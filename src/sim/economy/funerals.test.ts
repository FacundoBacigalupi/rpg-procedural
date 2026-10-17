import { describe, expect, it } from "vitest";
import { externalAccount, ledgerUnit, makeId } from "../../core/index.ts";
import { type FuneralInput, funeralExpense } from "./funerals.ts";

const home = externalAccount("household");
const lender = externalAccount("lender");
const priest = externalAccount("priest");
const grave = externalAccount("grave");
const copper = ledgerUnit("coin:copper");
const grain = ledgerUnit("good:grain");
const input: FuneralInput = {
  household: home,
  stocks: new Map([
    [copper, 20],
    [grain, 10],
  ]),
  materials: [{ unit: grain, amount: 10, destination: grave }],
  copper,
  fee: 100,
  provider: priest,
  faceWeight: 0.8,
  credit: {
    lenderCopper: 200,
    terms: {
      id: makeId("commitment", 1),
      lender: "agent:1",
      borrower: "agent:2",
      lenderAccount: lender,
      rate: 0.2,
      startDay: 1,
      dueDay: 90,
      collateral: [],
      guarantors: [],
      unsecuredLimit: 200,
      originEventId: "event:1",
    },
  },
};

describe("gasto funerario", () => {
  it("la familia pobre financia el déficit real, conserva cobre y deja ajuar recuperable", () => {
    const result = funeralExpense(input);
    expect(result.dignified).toBe(true);
    expect(result.loan?.principal).toBe(80);
    expect(result.loan?.originEventId).toBe("event:1");
    expect(result.faceLoss).toBe(0);
    const balances = new Map([
      [
        home,
        new Map([
          [copper, 20],
          [grain, 10],
        ]),
      ],
      [lender, new Map([[copper, 200]])],
      [priest, new Map()],
      [grave, new Map()],
    ]);
    for (const transfer of result.transfers) {
      const from = balances.get(transfer.from);
      const to = balances.get(transfer.to);
      if (from === undefined || to === undefined) throw new Error("cuenta inexistente");
      from.set(transfer.unit, (from.get(transfer.unit) ?? 0) - transfer.amount);
      to.set(transfer.unit, (to.get(transfer.unit) ?? 0) + transfer.amount);
      expect(from.get(transfer.unit)).toBeGreaterThanOrEqual(0);
    }
    expect(balances.get(grave)?.get(grain)).toBe(10);
    expect([...balances.values()].reduce((sum, b) => sum + (b.get(copper) ?? 0), 0)).toBe(220);
    expect(balances.get(priest)?.get(copper)).toBe(100);
  });

  it("no inventa dinero cuando la liquidez o el crédito disponible no alcanzan", () => {
    const credit = input.credit;
    if (credit === undefined) throw new Error("falta crédito del fixture");
    const result = funeralExpense({ ...input, credit: { ...credit, lenderCopper: 30 } });
    expect(result.loan?.principal).toBe(30);
    expect(result.paid).toBe(50);
    expect(result.unpaid).toBe(50);
    expect(result.faceLoss).toBe(0.4);
    const limited = funeralExpense({
      ...input,
      credit: { ...credit, terms: { ...credit.terms, unsecuredLimit: 5 } },
    });
    expect(limited.loan?.principal).toBe(5);
    const none = funeralExpense({ ...input, credit: undefined });
    expect(none.loan).toBeUndefined();
    expect(none.paid).toBe(20);
  });

  it("no reutiliza bienes de dos partidas ni se endeuda por materiales inexistentes", () => {
    const result = funeralExpense({
      ...input,
      materials: [
        { unit: grain, amount: 8, destination: grave },
        { unit: grain, amount: 8, destination: priest },
      ],
    });
    expect(result.materialsComplete).toBe(false);
    expect(result.loan).toBeUndefined();
    expect(result.transfers.filter((t) => t.unit === grain).map((t) => t.amount)).toEqual([8, 2]);
    expect(result.dignified).toBe(false);
    expect(result.faceLoss).toBeGreaterThan(0);
    expect(funeralExpense(input)).toEqual(funeralExpense(input));
    expect(input.stocks.get(grain)).toBe(10);
  });

  it("un hogar solvente no pide préstamo y el cobre enterrado no vuelve a pagar servicios", () => {
    const rich = funeralExpense({
      ...input,
      stocks: new Map([
        [copper, 150],
        [grain, 10],
      ]),
    });
    expect(rich.loan).toBeUndefined();
    expect(rich.dignified).toBe(true);
    const burial = funeralExpense({
      ...input,
      materials: [{ unit: copper, amount: 20, destination: grave }],
    });
    expect(burial.loan?.principal).toBe(100);
    expect(burial.transfers[0]).toEqual({ unit: copper, from: home, to: grave, amount: 20 });
  });
});
