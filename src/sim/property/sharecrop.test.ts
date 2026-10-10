import { describe, expect, it } from "vitest";
import { type HolderRef, holderAccount, ledgerUnit } from "../../core/index.ts";
import { settleSharecrop, sharecropFraction, sharecropOwed } from "./sharecrop.ts";

const A = (h: string) => holderAccount(h as unknown as HolderRef);
const U = ledgerUnit("grain:wheat");

describe("aparcería", () => {
  it("la fracción sube con lo que pone el dueño", () => {
    const none = { seed: false, oxen: false, tools: false };
    expect(sharecropFraction(none)).toBe(0.25);
    expect(sharecropFraction({ seed: true, oxen: true, tools: true })).toBeCloseTo(0.5, 9);
    expect(sharecropFraction({ ...none, seed: true })).toBeGreaterThan(sharecropFraction(none));
  });

  it("la parte es entera y redondea a favor del aparcero", () => {
    expect(sharecropOwed(10, 0.25)).toBe(2);
    expect(sharecropOwed(0, 0.5)).toBe(0);
    expect(sharecropOwed(100, 2)).toBe(100);
  });

  it("liquida lo que hay y deja el resto como atraso", () => {
    const base = { fraction: 0.5, unit: U, tenant: A("t"), landlord: A("l") };
    const full = settleSharecrop({ ...base, harvested: 100, available: 80 });
    expect(full).toMatchObject({ owed: 50, paid: 50, arrears: 0 });
    expect(full.transfers).toEqual([{ unit: U, from: A("t"), to: A("l"), amount: 50 }]);
    const short = settleSharecrop({ ...base, harvested: 100, available: 20, priorArrears: 5 });
    expect(short).toMatchObject({ owed: 50, paid: 20, arrears: 35 });
    const none = settleSharecrop({ ...base, harvested: 100, available: 0 });
    expect(none.transfers).toEqual([]);
    expect(none.arrears).toBe(50);
  });
});
