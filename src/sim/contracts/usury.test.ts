import { describe, expect, it } from "vitest";
import {
  chooseDisguise,
  DISGUISE_KINDS,
  disguiseInterest,
  disguiseOwed,
  effectiveAnnualRate,
  effectiveRate,
  estimateDisguise,
} from "./usury.ts";

const base = { principal: 100, rate: 0.2, termDays: 90, wagePerDay: 2 };

describe("usura disfrazada", () => {
  it("todos los disfraces esconden la tasa deseada y no declaran interés", () => {
    for (const kind of DISGUISE_KINDS) {
      const t = disguiseInterest({ ...base, kind });
      expect(t.statedRate).toBe(0);
      expect(effectiveRate(t)).toBeCloseTo(0.2, 9);
      expect(disguiseOwed(t)).toBeCloseTo(120, 9);
    }
  });
  it("cada forma carga en su campo", () => {
    expect(disguiseInterest({ ...base, kind: "gift" }).giftValue).toBeCloseTo(20);
    expect(disguiseInterest({ ...base, kind: "labor" }).laborDays).toBeCloseTo(10);
    expect(disguiseInterest({ ...base, kind: "buyback" }).moneyDue).toBeCloseTo(120);
  });
  it("trabajo sin jornal cae a dinero", () => {
    const t = disguiseInterest({ ...base, kind: "labor", wagePerDay: 0 });
    expect(t.laborDays).toBe(0);
    expect(effectiveRate(t)).toBeCloseTo(0.2);
  });
  it("anualiza compuesto", () => {
    const t = disguiseInterest({ ...base, kind: "gift", termDays: 365 });
    expect(effectiveAnnualRate(t)).toBeCloseTo(0.2);
    expect(effectiveAnnualRate(disguiseInterest({ ...base, kind: "gift" }))).toBeGreaterThan(0.2);
  });
  it("el tercero sospecha por sobre la tolerancia y se equivoca si tasa mal", () => {
    const t = disguiseInterest({ ...base, kind: "gift" });
    const obs = {
      believedReceivedValue: t.received,
      moneyDue: t.moneyDue,
      giftValue: t.giftValue,
      termDays: t.termDays,
    };
    expect(estimateDisguise(obs).suspected).toBe(true);
    expect(estimateDisguise(obs).impliedRate).toBeCloseTo(0.2);
    expect(estimateDisguise({ ...obs, believedReceivedValue: 125 }).suspected).toBe(false);
    expect(estimateDisguise(obs, 0.3).suspected).toBe(false);
    expect(estimateDisguise({ ...obs, believedReceivedValue: 0 }).suspected).toBe(false);
  });
  it("elige el disfraz menos visible", () => {
    expect(chooseDisguise(["labor", "buyback"])).toBe("buyback");
    expect(chooseDisguise(["labor", "gift"], { gift: 0.9 })).toBe("labor");
    expect(chooseDisguise([])).toBeUndefined();
  });
});
