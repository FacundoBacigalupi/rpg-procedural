import { describe, expect, it } from "vitest";
import { externalAccount, ledgerUnit, makeId } from "../../core/index.ts";
import type { HouseholdFlows } from "./budget.ts";
import {
  bargainingPower,
  type Collateral,
  collateralRealValue,
  disburseTransfers,
  estimatedDefault,
  executeDefault,
  interestOf,
  loanRate,
  makeLoan,
  outstanding,
  payLoan,
  totalDue,
  withLoanPayments,
} from "./credit.ts";

const lender = externalAccount("usurero");
const borrower = externalAccount("campesino");
const fiador = externalAccount("fiador");
const coin = ledgerUnit("coin:copper");
const land: Collateral = { ref: "parcel:1", believedValue: 1000, trueValue: 400, heldBy: borrower };

function loan(collateral: readonly Collateral[] = [land], requested = 500) {
  const l = makeLoan({
    id: makeId("commitment", 1),
    lender: "agent:1",
    borrower: "agent:2",
    lenderAccount: lender,
    borrowerAccount: borrower,
    unit: coin,
    requested,
    rate: 0.2,
    startDay: 0,
    dueDay: 100,
    collateral,
    guarantors: [{ id: "agent:3", account: fiador, share: 1 }],
    unsecuredLimit: 0,
    originEventId: "event:1",
  });
  if (!l) throw new Error("sin préstamo");
  return l;
}

const home: HouseholdFlows = {
  coins: 100,
  incomePerDay: 10,
  fixedPerDay: 1,
  foodCoinsPerAdultDay: 1,
  pantryDays: 10,
  adults: 2,
  children: 0,
  elders: 0,
};

describe("crédito de cosecha", () => {
  it("la tasa sube con el riesgo creído y la negociación, y respeta el tope", () => {
    const safe = estimatedDefault(
      { reputation: 1, expectedYieldCover: 2, enforceability: 1 },
      500,
      1000,
    );
    const risky = estimatedDefault(
      { reputation: 0.2, expectedYieldCover: 0.6, enforceability: 0.2 },
      500,
      0,
    );
    expect(risky).toBeGreaterThan(safe);
    expect(loanRate(risky, 0.5, 0.5)).toBeGreaterThan(loanRate(safe, 0.5, 0.5));
    expect(loanRate(0.2, 1, 0.5)).toBeGreaterThan(loanRate(0.2, 0, 0.5));
    expect(loanRate(1, 1, 1, 0.3)).toBe(0.3);
    expect(bargainingPower(1, 3)).toBeLessThan(bargainingPower(1, 0));
  });

  it("el principal se recorta al tope que da el colateral creído", () => {
    expect(loan().principal).toBe(500);
    expect(loan([{ ...land, believedValue: 100 }]).principal).toBe(60);
    const none = makeLoan({
      id: makeId("commitment", 2),
      lender: "a",
      borrower: "b",
      lenderAccount: lender,
      borrowerAccount: borrower,
      unit: coin,
      requested: 50,
      rate: 0.1,
      startDay: 0,
      dueDay: 10,
      collateral: [],
      guarantors: [],
      unsecuredLimit: 0,
      originEventId: "e",
    });
    expect(none).toBeUndefined();
  });

  it("la cuota entra a los gastos fijos del presupuesto", () => {
    const l = loan();
    expect(totalDue(l)).toBe(600);
    expect(interestOf(l)).toBe(100);
    expect(withLoanPayments(home, [l], 0).fixedPerDay).toBeCloseTo(7, 10);
    expect(withLoanPayments(home, [], 0)).toBe(home);
  });

  it("pagar conserva: solo da lo que tiene y salda al cubrir todo", () => {
    const l = loan();
    const a = payLoan(l, 1000, 250);
    expect(a.paid).toBe(250);
    expect(a.transfers[0]?.amount).toBe(250);
    expect(a.loan.status).toBe("active");
    const b = payLoan(a.loan, 1000, 1000);
    expect(b.paid).toBe(350);
    expect(b.loan.status).toBe("repaid");
    expect(disburseTransfers(l)[0]?.amount).toBe(500);
  });

  it("la mora ejecuta el colateral por su valor real, no por el creído", () => {
    const l = loan();
    expect(collateralRealValue([land])).toBe(320);
    const r = executeDefault(l, 100, new Map());
    expect(r.seized).toEqual([{ ref: "parcel:1", from: borrower, to: lender }]);
    expect(r.loss).toBe(280);
    expect(r.loan.status).toBe("defaulted");
    expect(executeDefault(l, 50, new Map()).seized).toHaveLength(0);
  });

  it("los fiadores cubren con lo que tengan; lo cobrado más lo perdido es lo debido", () => {
    const l = loan();
    const r = executeDefault(l, 100, new Map([["agent:3", 100]]));
    expect(r.transfers[0]?.amount).toBe(100);
    expect(r.loss).toBe(180);
    expect(320 + 100 + r.loss).toBe(outstanding(l));
    const rich = executeDefault(l, 100, new Map([["agent:3", 10_000]]));
    expect(rich.loss).toBe(0);
    expect(rich.loan.status).toBe("settled");
  });

  it("si el colateral sobra, no se toman las prendas de más", () => {
    const l = loan([
      { ref: "a", believedValue: 400, trueValue: 1000, heldBy: borrower },
      { ref: "b", believedValue: 400, trueValue: 1000, heldBy: borrower },
    ]);
    const r = executeDefault(l, 100, new Map());
    expect(r.seized.map((s) => s.ref)).toEqual(["a"]);
    expect(r.released).toEqual(["b"]);
    expect(r.loss).toBe(0);
  });
});
