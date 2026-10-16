import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { externalAccount, ledgerUnit, makeId } from "../../core/index.ts";
import { interestOf, makeLoan } from "./credit.ts";
import {
  kindInterestDue,
  kindInterestOutstanding,
  payLoanInKind,
  principalOutstanding,
  withKindInterest,
} from "./creditKind.ts";

const lender = externalAccount("usurero");
const borrower = externalAccount("campesino");
const coin = ledgerUnit("coin:copper");
const grain = ledgerUnit("grain:rice");

function loan(rate = 0.2, periods?: number) {
  const l = makeLoan({
    id: makeId("commitment", 1),
    lender: "agent:1",
    borrower: "agent:2",
    lenderAccount: lender,
    borrowerAccount: borrower,
    unit: coin,
    requested: 500,
    rate,
    ...(periods !== undefined ? { periods } : {}),
    startDay: 0,
    dueDay: 100,
    collateral: [],
    guarantors: [],
    unsecuredLimit: 1000,
    originEventId: "event:1",
  });
  if (!l) throw new Error("sin préstamo");
  return l;
}

describe("interés en especie", () => {
  it("sin inKind no hace nada (opt-in)", () => {
    const l = loan();
    expect(kindInterestDue(l)).toBe(0);
    const r = payLoanInKind(l, 100, 100, 1000, 1000);
    expect(r.loan).toBe(l);
    expect(r.transfers).toEqual([]);
  });

  it("el interés se convierte a la razón y se paga en la otra unidad", () => {
    const l = withKindInterest(loan(), grain, 0.5);
    expect(kindInterestDue(l)).toBe(Math.ceil(interestOf(l) * 0.5));
    const r = payLoanInKind(l, 500, kindInterestDue(l), 500, 1000);
    expect(r.loan.status).toBe("repaid");
    expect(r.transfers.map((t) => t.unit)).toEqual([coin, grain]);
  });

  it("el principal solo no salda: queda el interés", () => {
    const l = withKindInterest(loan(), grain, 1);
    const r = payLoanInKind(l, 500, 0, 500, 0);
    expect(r.loan.status).toBe("active");
    expect(principalOutstanding(r.loan)).toBe(0);
    expect(kindInterestOutstanding(r.loan)).toBe(100);
  });

  it("misma entrada, mismo resultado", () => {
    const l = withKindInterest(loan(0.1, 3), grain, 2);
    expect(payLoanInKind(l, 70, 30, 100, 100)).toEqual(payLoanInKind(l, 70, 30, 100, 100));
  });

  it("conservación por unidad en cualquier secuencia de pagos", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.5, noNaN: true }),
        fc.integer({ min: 1, max: 6 }),
        fc.double({ min: 0.1, max: 4, noNaN: true }),
        fc.array(
          fc.record({
            op: fc.integer({ min: 0, max: 600 }),
            oi: fc.integer({ min: 0, max: 600 }),
            hp: fc.integer({ min: 0, max: 600 }),
            hi: fc.integer({ min: 0, max: 600 }),
          }),
          { maxLength: 8 },
        ),
        (rate, periods, ratio, steps) => {
          let l = withKindInterest(loan(rate, periods), grain, ratio);
          let coinsB = 100_000;
          let grainB = 100_000;
          let coinsL = 0;
          let grainL = 0;
          for (const s of steps) {
            const r = payLoanInKind(l, s.op, s.oi, Math.min(s.hp, coinsB), Math.min(s.hi, grainB));
            for (const t of r.transfers) {
              if (t.unit === coin) {
                coinsB -= t.amount;
                coinsL += t.amount;
              } else {
                grainB -= t.amount;
                grainL += t.amount;
              }
            }
            l = r.loan;
            expect(coinsB + coinsL).toBe(100_000);
            expect(grainB + grainL).toBe(100_000);
            expect(coinsB).toBeGreaterThanOrEqual(0);
            expect(grainB).toBeGreaterThanOrEqual(0);
            expect(l.paid).toBeLessThanOrEqual(l.principal);
            expect(l.inKind?.paidKind ?? 0).toBeLessThanOrEqual(kindInterestDue(l));
          }
          expect(coinsL).toBe(l.paid);
          expect(grainL).toBe(l.inKind?.paidKind);
        },
      ),
    );
  });
});
