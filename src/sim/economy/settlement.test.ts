import { describe, expect, it } from "vitest";
import {
  externalAccount,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
  type Transfer,
} from "../../core/index.ts";
import { validateSettlement } from "./settlement.ts";

const grain = ledgerUnit("good:grain");
const copper = ledgerUnit("coin:copper");
const larder = holderAccount(makeId("household", 1));
const a = holderAccount(makeId("agent", 1));
const b = holderAccount(makeId("agent", 2));
const c = holderAccount(makeId("agent", 3));
function stock(grains: number, coins = 0) {
  const ledger = new Ledger({ externals: { seed: [grain, copper] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { from: externalAccount("seed"), to: larder, unit: grain, amount: grains },
      ...(coins === 0
        ? []
        : [{ from: externalAccount("seed"), to: a, unit: copper, amount: coins }]),
    ],
  });
  return ledger;
}
describe("confirmar intercambio sobre saldos y reservas actuales", () => {
  it("un segundo regalo rechaza tocar la reserva sin modificar saldos ni diario", () => {
    const ledger = stock(9500);
    const transfers: Transfer[] = [{ from: larder, to: a, unit: grain, amount: 500 }];
    const reserves = [{ account: larder, unit: grain, minimum: 9000 }];
    expect(validateSettlement(ledger, transfers, reserves)).toEqual({ allowed: true });
    ledger.post({ tick: 10, eventId: makeId("event", 2), transfers });
    const journal = [...ledger.journal()];
    expect(validateSettlement(ledger, transfers, reserves)).toEqual({
      allowed: false,
      shortages: [
        {
          reason: "reserve",
          account: larder,
          unit: grain,
          before: 9000,
          after: 8500,
          minimum: 9000,
        },
      ],
    });
    expect(ledger.journal()).toEqual(journal);
    expect(ledger.balance(larder, grain)).toBe(9000);
  });

  it("revalida la contraprestación compartida antes de confirmar otro trato", () => {
    const ledger = stock(10000, 1);
    const trade = (listener: typeof b): Transfer[] => [
      { from: a, to: listener, unit: copper, amount: 1 },
      { from: larder, to: a, unit: grain, amount: 500 },
    ];
    const reserves = [{ account: larder, unit: grain, minimum: 9000 }];
    expect(validateSettlement(ledger, trade(b), reserves)).toEqual({ allowed: true });
    ledger.post({ tick: 10, eventId: makeId("event", 2), transfers: trade(b) });
    const second = validateSettlement(ledger, trade(c), reserves);
    expect(second).toMatchObject({
      allowed: false,
      shortages: [{ reason: "stock", account: a, unit: copper, before: 0, after: -1, minimum: 0 }],
    });
    expect(ledger.balance(larder, grain)).toBe(9500);
    expect(ledger.audit()).toEqual([]);
  });

  it("admite ambas operaciones cuando alcanza y no depende del orden de sus patas", () => {
    const ledger = stock(10000, 2);
    const transfers = [
      { from: a, to: b, unit: copper, amount: 1 },
      { from: larder, to: a, unit: grain, amount: 500 },
    ];
    expect(validateSettlement(ledger, transfers)).toEqual(
      validateSettlement(ledger, [...transfers].reverse()),
    );
    ledger.post({ tick: 10, eventId: makeId("event", 2), transfers });
    expect(
      validateSettlement(ledger, transfers, [{ account: larder, unit: grain, minimum: 9000 }]),
    ).toEqual({ allowed: true });
  });

  it("rechaza cantidades inseguras y reservas inválidas antes de leer el ledger", () => {
    const ledger = {
      balance: () => {
        throw new Error("no debe leer saldos");
      },
    };
    for (const amount of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => validateSettlement(ledger, [{ from: a, to: b, unit: copper, amount }])).toThrow(
        RangeError,
      );
    expect(() =>
      validateSettlement(ledger, [], [{ account: larder, unit: grain, minimum: -1 }]),
    ).toThrow(RangeError);
  });
});
